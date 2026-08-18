package backend

import (
	"errors"
	"fmt"
	"strings"

	keyring "github.com/zalando/go-keyring"
)

const keyringServiceName = "Image Studio"

// apiKeyStore 用任意 string 作为 user(底层 keyring 项的「账号」字段)寻址,
// 不再硬编 responses/images 二选一。v0.1.6 起前端按 profile id 走:
//
//	"api-key:profile:<uuid>"   <- 一个 profile 一个槽
//	"api-key:responses"         <- 老格式,仅 bootstrap 迁移时读一次
//	"api-key:images"            <- 老格式,仅 bootstrap 迁移时读一次
type apiKeyStore interface {
	Get(user string) (string, error)
	Set(user, value string) error
	Delete(user string) error
}

type keyringAPIKeyStore struct{}

func (keyringAPIKeyStore) Get(user string) (string, error) {
	value, err := keyring.Get(keyringServiceName, user)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", nil
	}
	return value, err
}

func (keyringAPIKeyStore) Set(user, value string) error {
	return keyring.Set(keyringServiceName, user, value)
}

func (keyringAPIKeyStore) Delete(user string) error {
	err := keyring.Delete(keyringServiceName, user)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}

// normalizeKeyringUser 校验前端传上来的 user 字符串。允许两种命名空间:
//  1. 老格式 "responses" / "images" —— 自动转成 "api-key:<mode>"。
//     bootstrap 迁移期前端依然会按这两个 user 读老 key。
//  2. 新格式 "profile:<id>"          —— 自动转成 "api-key:profile:<id>"。
//
// 任何不带这两个前缀的传入都拒绝,避免被构造任意 keyring 项写入。
func normalizeKeyringUser(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("api key identifier is empty")
	}
	switch trimmed {
	case "responses", "images":
		return "api-key:" + trimmed, nil
	}
	if strings.HasPrefix(trimmed, "profile:") {
		// 限制 id 字符集,避免奇异字符进 keyring 项名
		rest := strings.TrimPrefix(trimmed, "profile:")
		if rest == "" {
			return "", errors.New("profile id is empty")
		}
		for _, r := range rest {
			if r == '-' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
				continue
			}
			return "", fmt.Errorf("invalid character %q in profile id", r)
		}
		return "api-key:profile:" + rest, nil
	}
	return "", fmt.Errorf("unrecognised api key identifier: %s", trimmed)
}

// GetStoredAPIKey 取一条上游 API key。`user` 是 normalizeKeyringUser 接受的
// 任一形式(profile id 或老的 responses/images)。
func (s *Service) GetStoredAPIKey(user string) (string, error) {
	normalized, err := normalizeKeyringUser(user)
	if err != nil {
		return "", err
	}
	return s.apiKeys.Get(normalized)
}

// SetStoredAPIKey 写入 / 更新一条上游 API key。空 value 等价于 Delete,方便
// 前端「清空 key」的语义。
func (s *Service) SetStoredAPIKey(user, value string) error {
	normalized, err := normalizeKeyringUser(user)
	if err != nil {
		return err
	}
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return s.apiKeys.Delete(normalized)
	}
	return s.apiKeys.Set(normalized, trimmed)
}

// DeleteStoredAPIKey 用在 profile 被删除时清掉对应 keyring 项,避免 keyring
// 里堆积孤儿 key。也用在 bootstrap 迁移完老 responses/images 后清理。
func (s *Service) DeleteStoredAPIKey(user string) error {
	normalized, err := normalizeKeyringUser(user)
	if err != nil {
		return err
	}
	return s.apiKeys.Delete(normalized)
}
