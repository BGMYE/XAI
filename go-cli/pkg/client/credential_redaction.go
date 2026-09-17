package client

import (
	"bytes"
	"io"
	"net/http"
	"strings"
)

const credentialPlaceholder = "[redacted]"

func redactCredential(text, credential string) string {
	if credential = strings.TrimSpace(credential); credential != "" {
		return strings.ReplaceAll(text, credential, credentialPlaceholder)
	}
	return text
}

type credentialError struct {
	message string
	cause   error
}

func (e credentialError) Error() string { return e.message }
func (e credentialError) Unwrap() error { return e.cause }

func redactCredentialError(err error, credential string) error {
	if err == nil {
		return nil
	}
	message := redactCredential(err.Error(), credential)
	if message == err.Error() {
		return err
	}
	return credentialError{message, err}
}

// Keep at most one credential-sized suffix across writes. Redaction happens
// before raw logs and parsers, including when a network chunk splits the key.
type credentialWriter struct {
	destination io.Writer
	credential  []byte
	pending     []byte
}

func newCredentialWriter(destination io.Writer, credential string) *credentialWriter {
	return &credentialWriter{destination: destination, credential: []byte(strings.TrimSpace(credential))}
}

func (w *credentialWriter) Write(p []byte) (int, error) {
	if len(w.credential) == 0 {
		return w.destination.Write(p)
	}
	w.pending = append(w.pending, p...)
	for {
		index := bytes.Index(w.pending, w.credential)
		if index < 0 {
			break
		}
		if _, err := w.destination.Write(w.pending[:index]); err != nil {
			return 0, err
		}
		if _, err := io.WriteString(w.destination, credentialPlaceholder); err != nil {
			return 0, err
		}
		w.pending = w.pending[index+len(w.credential):]
	}
	keep := min(len(w.pending), len(w.credential)-1)
	for keep > 0 && !bytes.Equal(w.pending[len(w.pending)-keep:], w.credential[:keep]) {
		keep--
	}
	count := len(w.pending) - keep
	if count > 0 {
		if _, err := w.destination.Write(w.pending[:count]); err != nil {
			return 0, err
		}
		w.pending = append(w.pending[:0], w.pending[count:]...)
	}
	return len(p), nil
}

func (w *credentialWriter) Flush() error {
	_, err := w.destination.Write(w.pending)
	w.pending = nil
	return err
}

type credentialReader struct {
	source io.Reader
	buffer bytes.Buffer
	writer *credentialWriter
	err    error
}

func (r *credentialReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for r.buffer.Len() == 0 && r.err == nil {
		var chunk [32 * 1024]byte
		n, err := r.source.Read(chunk[:])
		if n == 0 && err == nil {
			return 0, nil
		}
		_, _ = r.writer.Write(chunk[:n])
		if err != nil {
			r.err = err
			_ = r.writer.Flush()
		}
	}
	if r.buffer.Len() > 0 {
		return r.buffer.Read(p)
	}
	return 0, r.err
}

func redactResponseBody(response *http.Response, credential string) {
	if strings.TrimSpace(credential) == "" {
		return
	}
	reader := &credentialReader{source: response.Body}
	reader.writer = newCredentialWriter(&reader.buffer, credential)
	response.Body = struct {
		io.Reader
		io.Closer
	}{reader, response.Body}
}
