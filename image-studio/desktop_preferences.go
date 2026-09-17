package main

// SystemPreferences complements media queries on WebViews which don't expose
// the platform accessibility preferences. Nil leaves that preference to CSS.
type SystemPreferences struct {
	Dark               *bool `json:"dark,omitempty"`
	ReduceTransparency *bool `json:"reduceTransparency,omitempty"`
	ReduceMotion       *bool `json:"reduceMotion,omitempty"`
	HighContrast       *bool `json:"highContrast,omitempty"`
}

func (h *DesktopHost) GetSystemPreferences() SystemPreferences { return readSystemPreferences() }
func boolRef(value bool) *bool                                 { return &value }
