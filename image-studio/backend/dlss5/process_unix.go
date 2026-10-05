//go:build !windows

package dlss5

import (
	"os/exec"
	"syscall"
)

func configureProcess(cmd *exec.Cmd)               { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func ownProcessTree(cmd *exec.Cmd) (func(), error) { return func() { terminateProcess(cmd) }, nil }
func terminateProcess(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Process.Kill()
	}
}
