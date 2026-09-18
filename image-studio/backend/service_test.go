package backend

import("context";"encoding/json";"errors";"path/filepath";"strings";"testing";"image-studio/backend/internal/taskqueue")
func TestStartJobRejectsWhenConcurrencyLimitReached(t *testing.T){
 svc:=NewService();svc.ctx=context.Background()
 m,err:=taskqueue.New(svc.ctx,taskqueue.FileRepository{Path:filepath.Join(t.TempDir(),"tasks.json")},nil);if err!=nil{t.Fatal(err)}
 svc.taskOnce.Do(func(){svc.tasks=m});defer m.Shutdown(context.Background())
 _,err=m.Submit(taskqueue.Record{ID:"existing",Kind:"image",Queue:"responses"},1,true,func(ctx context.Context,_ taskqueue.Reporter)(json.RawMessage,error){<-ctx.Done();return nil,ctx.Err()});if err!=nil{t.Fatal(err)}
 _,err=svc.Generate(GenerateOptions{APIKey:"sk-test",Prompt:"a red dot",APIMode:"responses",ConcurrencyLimit:1});if err==nil||!strings.Contains(err.Error(),"并发限制 1"){t.Fatalf("unexpected error: %v",err)}
}
func TestTaskFailureDoesNotPersistKey(t *testing.T){result,err:=redactTaskFailure(json.RawMessage(`{"message":"echo sk-secret","rawPath":"/tmp/log"}`),errors.New("upstream echo sk-secret"),"sk-secret");if strings.Contains(string(result),"sk-secret")||strings.Contains(err.Error(),"sk-secret"){t.Fatal("key leaked")};if !strings.Contains(string(result),"/tmp/log"){t.Fatal("lost log path")}}
