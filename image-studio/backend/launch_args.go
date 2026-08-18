package backend

import "strings"

const (
	latestReleaseAPIURLArg = "--image-studio-latest-release-api-url"
	appUpdateProbePathArg  = "--image-studio-app-update-probe-path"
	appUpdateProbeQuitArg  = "--image-studio-app-update-probe-quit"
)

func commandLineArgValue(args []string, flagName string) string {
	if flagName == "" {
		return ""
	}
	for index := 0; index < len(args); index++ {
		current := strings.TrimSpace(args[index])
		if current == "" {
			continue
		}
		if strings.HasPrefix(current, flagName+"=") {
			return strings.TrimSpace(strings.TrimPrefix(current, flagName+"="))
		}
		if current == flagName && index+1 < len(args) {
			return strings.TrimSpace(args[index+1])
		}
	}
	return ""
}

func commandLineBoolFlag(args []string, flagName string) bool {
	if flagName == "" {
		return false
	}
	for _, raw := range args {
		current := strings.TrimSpace(raw)
		if current == "" {
			continue
		}
		if current == flagName {
			return true
		}
		if strings.HasPrefix(current, flagName+"=") {
			value := strings.TrimSpace(strings.TrimPrefix(current, flagName+"="))
			if value == "" {
				return true
			}
			switch strings.ToLower(value) {
			case "0", "false", "no", "off":
				return false
			default:
				return true
			}
		}
	}
	return false
}
