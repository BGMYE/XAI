package taskqueue

import("encoding/json";"errors";"io";"os";"path/filepath")
func ValidID(id string)bool{if len(id)<1||len(id)>128{return false};for _,c:=range id{if c!='-'&&c!='_'&&(c<'a'||c>'z')&&(c<'A'||c>'Z')&&(c<'0'||c>'9'){return false}};return true}
type FileRepository struct{Path string}
func(f FileRepository)Load()([]Record,error){
 file,err:=os.Open(f.Path);if errors.Is(err,os.ErrNotExist){return nil,nil};if err!=nil{return nil,err};defer file.Close()
 var data struct{Version int `json:"version"`;Tasks []Record `json:"tasks"`}
 bytes,err:=io.ReadAll(io.LimitReader(file,16*1024*1024+1));if err!=nil{return nil,err};if len(bytes)>16*1024*1024{return nil,errors.New("task database exceeds size limit")}
 if err=json.Unmarshal(bytes,&data);err!=nil{return nil,err};if data.Version!=1{return nil,errors.New("unsupported task database version")};return data.Tasks,nil
}
func(f FileRepository)Save(records []Record)error{
 // Retain the newest 1000 terminal tasks without evicting active work.
 retained:=make([]Record,0,len(records));terminal:=0
 for _,r:=range records{if Terminal(r.Status){terminal++;if terminal>1000{continue}};retained=append(retained,r)}
 data,err:=json.Marshal(struct{Version int `json:"version"`;Tasks []Record `json:"tasks"`}{1,retained});if err!=nil{return err};if len(data)>16*1024*1024{return errors.New("task database exceeds size limit")};return AtomicWrite(f.Path,data)
}
// AtomicWrite leaves the previous valid document intact on write failure.
func AtomicWrite(path string,data []byte)error{
 if err:=os.MkdirAll(filepath.Dir(path),0700);err!=nil{return err}
 file,err:=os.CreateTemp(filepath.Dir(path),".studio-*");if err!=nil{return err};tmp:=file.Name();defer os.Remove(tmp)
 if err=file.Chmod(0600);err==nil{_,err=file.Write(data)};if err==nil{err=file.Sync()};closeErr:=file.Close()
 if err!=nil{return err};if closeErr!=nil{return closeErr};return os.Rename(tmp,path)
}
