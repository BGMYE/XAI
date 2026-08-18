import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? 1}\n${stderr || stdout}`));
    });
  });
}

const tmpDir = path.join(process.cwd(), ".tmp");
await mkdir(tmpDir, { recursive: true });
const sourcePath = path.join(tmpDir, "local-websocket-smoke-main.go");

const source = `package main
import (
  "context"
  "encoding/json"
  "fmt"
  "net"
  "net/http"
  "os"
  "path/filepath"
  "strings"
  client "github.com/yuanhua/image-gptcodex/pkg/client"
  "github.com/gorilla/websocket"
)
func main() {
  mux := http.NewServeMux()
  mux.HandleFunc("/v1/models", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    _, _ = w.Write([]byte(\`{"data":[{"id":"gpt-5.5"},{"id":"gpt-image-2"}]}\`))
  })
  upgrader := websocket.Upgrader{}
  mux.HandleFunc("/v1/responses", func(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
      panic(err)
    }
    defer conn.Close()
    _, raw, err := conn.ReadMessage()
    if err != nil {
      panic(err)
    }
    var payload map[string]any
    if err := json.Unmarshal(raw, &payload); err != nil {
      panic(err)
    }
    if payload["type"] != "response.create" {
      panic("expected response.create payload")
    }
    _ = conn.WriteMessage(websocket.TextMessage, []byte(\`{"type":"response.created","response":{"id":"resp_local_smoke"}}\`))
    _ = conn.WriteMessage(websocket.TextMessage, []byte(\`{"type":"response.output_item.done","item":{"type":"image_generation_call","result":"c21va2Utd3MtaW1hZ2U=","revised_prompt":"smoke ws revised prompt"}}\`))
    _ = conn.WriteMessage(websocket.TextMessage, []byte(\`{"type":"response.completed"}\`))
  })
  listener, err := net.Listen("tcp", "127.0.0.1:0")
  if err != nil { panic(err) }
  server := &http.Server{Handler: mux}
  defer server.Shutdown(context.Background())
  go server.Serve(listener)
  origin := "http://" + listener.Addr().String()
  outDir, err := os.MkdirTemp("", "image-studio-ws-smoke-*")
  if err != nil { panic(err) }
  defer os.RemoveAll(outDir)
  result, rawPath, err := client.RequestAndExtractWithRetriesAndPartial(
    context.Background(),
    &client.NativeTransport{},
    client.Options{
      APIKey: "smoke-key",
      Prompt: "cat",
      BaseURL: origin,
      APIMode: client.APIModeResponses,
      ResponsesTransport: client.ResponsesTransportWebSocket,
    },
    outDir,
    "smoke",
    nil,
    nil,
    nil,
  )
  if err != nil { panic(err) }
  abs, _ := filepath.Abs(rawPath)
  fmt.Println(result.ImageB64)
  fmt.Println(result.RevisedPrompt)
  fmt.Println(strings.TrimSpace(abs))
}
`;

await writeFile(sourcePath, source, "utf8");

try {
  const { stdout } = await run("go", ["run", sourcePath], {
    cwd: process.cwd(),
    env: {
      GOPATH: path.join(process.cwd(), ".gopath"),
      GOMODCACHE: path.join(process.cwd(), ".gomodcache"),
      GOCACHE: path.join(process.cwd(), ".gocache"),
    },
  });
  const lines = stdout.trim().split(/\r?\n/);
  const imageB64 = lines[0] ?? "";
  const revisedPrompt = lines[1] ?? "";
  const rawPath = lines.slice(2).join("\n");
  console.log(JSON.stringify({
    status: "passed",
    imageB64,
    revisedPrompt,
    rawPath,
  }, null, 2));
} finally {
  await rm(sourcePath, { force: true });
}
