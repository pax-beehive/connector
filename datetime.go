package connector

import (
	"encoding/json"
	"fmt"
	"time"
)

// DateTime is a time.Time that tolerates API date-time strings with or
// without timezone or fractional seconds, and marshals without a zone
// (site-local convention used by APIs such as Mindbody).
//
// Marshaling emits the wall-clock reading of the stored time and DROPS any
// zone/offset: a value parsed from "10:00:00+07:00" is re-emitted as
// "10:00:00". The API interprets that wall clock in the site's local zone,
// so construct DateTime values in the site's local time, not in UTC or the
// caller's zone.
type DateTime struct{ time.Time }

const dateTimeLayout = "2006-01-02T15:04:05"

var dateTimeLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05.999999999",
	"2006-01-02T15:04:05-0700", // offset without colon (Meta Graph API)
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
