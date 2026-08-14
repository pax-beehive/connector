package connector

import (
	"encoding/json"
	"fmt"
	"time"
)

// DateTime is a time.Time that tolerates API date-time strings with or
// without timezone or fractional seconds, and marshals without a zone
// (site-local convention used by APIs such as Mindbody).
type DateTime struct{ time.Time }

const dateTimeLayout = "2006-01-02T15:04:05"

var dateTimeLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05.999999999",
	dateTimeLayout,
	"2006-01-02",
}

func (t *DateTime) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		if string(b) == "null" {
			return nil
		}
		return err
	}
	if s == "" {
		return nil
	}
	for _, layout := range dateTimeLayouts {
		if parsed, err := time.Parse(layout, s); err == nil {
			t.Time = parsed
			return nil
		}
	}
	return fmt.Errorf("connector: cannot parse datetime %q", s)
}

func (t DateTime) MarshalJSON() ([]byte, error) {
	return json.Marshal(t.Format(dateTimeLayout))
}

func (t DateTime) String() string { return t.Format(dateTimeLayout) }
