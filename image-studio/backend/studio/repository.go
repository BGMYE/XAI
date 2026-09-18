package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type document struct {
	Version  int                `json:"version"`
	Profiles map[string]Profile `json:"profiles"`
	Projects map[string]Project `json:"projects"`
	Assets   map[string]Asset   `json:"assets"`
	Jobs     map[string]Job     `json:"jobs"`
}

func emptyDocument() document {
	return document{SchemaVersion, map[string]Profile{}, map[string]Project{}, map[string]Asset{}, map[string]Job{}}
}
func cloneDocument(d document) document {
	b, _ := json.Marshal(d)
	var out document
	_ = json.Unmarshal(b, &out)
	return out
}

type repository struct{ root string }

func (r repository) read() (document, error) {
	if err := os.MkdirAll(filepath.Join(r.root, "media"), 0700); err != nil {
		return document{}, err
	}
	f, err := os.Open(filepath.Join(r.root, "studio.json"))
	if errors.Is(err, os.ErrNotExist) {
		return emptyDocument(), nil
	}
	if err != nil {
		return document{}, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 64*1024*1024+1))
	if err != nil {
		return document{}, err
	}
	if len(b) > 64*1024*1024 {
		return document{}, errors.New("工作室数据库超过 64 MB，请先归档")
	}
	var d document
	if err = json.Unmarshal(b, &d); err != nil {
		return document{}, fmt.Errorf("数据库损坏，已保留原文件，拒绝覆盖：%w", err)
	}
	if d.Version != SchemaVersion {
		return document{}, fmt.Errorf("不支持的数据库版本 %d；原文件未修改", d.Version)
	}
	if d.Profiles == nil || d.Projects == nil || d.Assets == nil || d.Jobs == nil {
		return document{}, errors.New("数据库结构不完整，拒绝覆盖")
	}
	for id, p := range d.Profiles {
		if p.ID != id {
			return document{}, errors.New("上游索引损坏")
		}
		if err := p.Validate(); err != nil {
			return document{}, err
		}
	}
	for id, a := range d.Assets {
		if checkID(id) != nil || a.ID != id || filepath.Base(a.FileName) != a.FileName || !strings.HasPrefix(a.FileName, id+".") {
			return document{}, errors.New("素材索引损坏，拒绝读取任意文件路径")
		}
	}
	for _, p := range d.Projects {
		if _, err := p.Order(); err != nil {
			return document{}, err
		}
	}
	return d, nil
}
func (r repository) write(d document) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	if len(b) > 64*1024*1024 {
		return errors.New("数据库超过 64 MB，请先归档")
	}
	return atomicWrite(filepath.Join(r.root, "studio.json"), b)
}
func atomicWrite(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".studio-tmp-*")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	// The old document remains intact on any failure before the atomic rename.
	return os.Rename(temp, path)
}
