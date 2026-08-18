// Package promptui contains terminal interaction helpers used only by the CLI.
// Wails app does NOT import this package — it gathers input from the UI.
package promptui

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/yuanhua/image-gptcodex/pkg/client"
)

type Prompter struct {
	in  *bufio.Reader
	out io.Writer
}

func NewPrompter() *Prompter {
	return &Prompter{
		in:  bufio.NewReader(os.Stdin),
		out: os.Stdout,
	}
}

func (p *Prompter) readLine(prompt string) (string, error) {
	fmt.Fprint(p.out, prompt)
	line, err := p.in.ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func (p *Prompter) APIKey() (string, error) {
	fmt.Fprintln(p.out, "请输入 API Key。")
	fmt.Fprintln(p.out, `注意:请先在 GPTCODEX 中转站后台,把这个 key 选择为"余额分组"或"套餐分组",不用选择 image-2 分组。`)
	v, err := p.readLine("API Key: ")
	if err != nil {
		return "", err
	}
	v = strings.TrimSpace(v)
	if v == "" {
		return "", fmt.Errorf("API Key 不能为空")
	}
	return v, nil
}

func (p *Prompter) Mode() (client.Mode, error) {
	fmt.Fprintln(p.out, "请选择生成模式:")
	fmt.Fprintln(p.out, "  1. 文生图(只输入提示词)")
	fmt.Fprintln(p.out, "  2. 图生图 / 编辑图片(输入原图路径 + 修改要求)")
	v, err := p.readLine("输入 1 或 2: ")
	if err != nil {
		return "", err
	}
	switch strings.TrimSpace(v) {
	case "1":
		return client.ModeGenerate, nil
	case "2":
		return client.ModeEdit, nil
	default:
		return "", fmt.Errorf("模式选择无效,只能输入 1 或 2")
	}
}

func (p *Prompter) ImagePath() (string, error) {
	raw, err := p.readLine(`请输入要修改的图片路径,例如 E:\photos\图片名.png: `)
	if err != nil {
		return "", err
	}
	return client.NormalizePath(raw)
}

func (p *Prompter) Size() (string, error) {
	fmt.Fprintln(p.out, "请选择图片比例:")
	for i, opt := range client.SizeOptions {
		fmt.Fprintf(p.out, "  %d. %s\n", i+1, opt.Label)
	}
	v, err := p.readLine(fmt.Sprintf("输入 1-%d: ", len(client.SizeOptions)))
	if err != nil {
		return "", err
	}
	idx := parseIndex(v, len(client.SizeOptions))
	if idx < 0 {
		return "", fmt.Errorf("比例选择无效")
	}
	return client.SizeOptions[idx].Value, nil
}

func (p *Prompter) Quality() (string, error) {
	fmt.Fprintln(p.out, "请选择生成质量:")
	for i, opt := range client.QualityOptions {
		fmt.Fprintf(p.out, "  %d. %s\n", i+1, opt.Label)
	}
	v, err := p.readLine(fmt.Sprintf("输入 1-%d: ", len(client.QualityOptions)))
	if err != nil {
		return "", err
	}
	idx := parseIndex(v, len(client.QualityOptions))
	if idx < 0 {
		return "", fmt.Errorf("质量选择无效")
	}
	return client.QualityOptions[idx].Value, nil
}

func (p *Prompter) PromptText(mode client.Mode) (string, error) {
	label := "请输入提示词: "
	if mode == client.ModeEdit {
		label = "请输入修改要求: "
	}
	v, err := p.readLine(label)
	if err != nil {
		return "", err
	}
	v = strings.TrimSpace(v)
	if v == "" {
		return "", fmt.Errorf("提示词/修改要求不能为空")
	}
	return v, nil
}

func parseIndex(v string, max int) int {
	v = strings.TrimSpace(v)
	if len(v) != 1 {
		return -1
	}
	c := v[0]
	if c < '1' || int(c-'0') > max {
		return -1
	}
	return int(c - '1')
}
