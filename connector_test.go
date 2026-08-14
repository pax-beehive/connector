package connector

import (
	"encoding/json"
	"testing"
	"time"
)

func TestPtr(t *testing.T) {
	if *Ptr(42) != 42 || *Ptr("a") != "a" {
		t.Fatal("Ptr roundtrip failed")
	}
}

func TestDateTimeUnmarshal(t *testing.T) {
	cases := []struct {
		in   string
		want time.Time
	}{
		{`"2020-01-02T15:04:05Z"`, time.Date(2020, 1, 2, 15, 4, 5, 0, time.UTC)},
		{`"2020-01-02T15:04:05"`, time.Date(2020, 1, 2, 15, 4, 5, 0, time.UTC)},
		{`"2020-01-02T15:04:05.123"`, time.Date(2020, 1, 2, 15, 4, 5, 123000000, time.UTC)},
		{`"2020-01-02"`, time.Date(2020, 1, 2, 0, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		var dt DateTime
		if err := json.Unmarshal([]byte(c.in), &dt); err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if !dt.Time.Equal(c.want) {
			t.Errorf("%s: got %v want %v", c.in, dt.Time, c.want)
		}
	}
	var dt DateTime
	if err := json.Unmarshal([]byte(`"nope"`), &dt); err == nil {
		t.Error("expected error for garbage datetime")
	}
	if err := json.Unmarshal([]byte(`null`), &dt); err != nil {
		t.Errorf("null should be accepted: %v", err)
	}
}

func TestDateTimeMarshal(t *testing.T) {
	dt := DateTime{time.Date(2020, 1, 2, 15, 4, 5, 0, time.UTC)}
	b, err := json.Marshal(dt)
	if err != nil || string(b) != `"2020-01-02T15:04:05"` {
		t.Fatalf("got %s, %v", b, err)
	}
	if dt.String() != "2020-01-02T15:04:05" {
		t.Fatalf("String() = %s", dt.String())
	}
}

func TestAPIError(t *testing.T) {
	e := &APIError{StatusCode: 400, Code: "BadRequest", Message: "nope", Body: []byte(`{}`)}
	if e.Error() == "" {
		t.Fatal("empty error string")
	}
	plain := &APIError{StatusCode: 500, Body: []byte(`boom`)}
	if plain.Error() == "" {
		t.Fatal("empty error string for unparsed body")
	}
}
