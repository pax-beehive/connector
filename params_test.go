package connector

import (
	"testing"
	"time"
)

type sampleReq struct {
	Limit     *int      `json:"-" query:"request.limit"`
	Name      *string   `json:"-" query:"request.name"`
	Active    *bool     `json:"-" query:"request.active"`
	Rate      *float64  `json:"-" query:"request.rate"`
	IDs       []int     `json:"-" query:"request.ids"`
	Tags      []string  `json:"-" query:"request.tags"`
	Start     *DateTime `json:"-" query:"request.start"`
	ClientID  string    `json:"-" path:"clientId"`
	Token     *string   `json:"-" header:"consumer-identity-token"`
	BodyField *string   `json:"BodyField,omitempty"` // no tag: ignored
}

func TestParseRequestParams(t *testing.T) {
	start := DateTime{time.Date(2020, 5, 1, 9, 0, 0, 0, time.UTC)}
	req := &sampleReq{
		Limit: Ptr(25), Name: Ptr("bob"), Active: Ptr(true), Rate: Ptr(1.5),
		IDs: []int{1, 2}, Tags: []string{"a"}, Start: &start,
		ClientID: "c-9", Token: Ptr("tok"),
	}
	p, err := ParseRequestParams(req)
	if err != nil {
		t.Fatal(err)
	}
	q := p.Query
	if q.Get("request.limit") != "25" || q.Get("request.name") != "bob" ||
		q.Get("request.active") != "true" || q.Get("request.rate") != "1.5" {
		t.Errorf("scalar encoding wrong: %v", q)
	}
	if got := q["request.ids"]; len(got) != 2 || got[0] != "1" || got[1] != "2" {
		t.Errorf("array encoding wrong: %v", got)
	}
	if q.Get("request.start") != "2020-05-01T09:00:00" {
		t.Errorf("datetime encoding wrong: %v", q.Get("request.start"))
	}
	if p.Path["clientId"] != "c-9" {
		t.Errorf("path param wrong: %v", p.Path)
	}
	if p.Header["consumer-identity-token"] != "tok" {
		t.Errorf("header param wrong: %v", p.Header)
	}
	if _, ok := q["BodyField"]; ok {
		t.Error("untagged field must not be encoded")
	}
}

func TestParseRequestParamsNilAndEmpty(t *testing.T) {
	for _, req := range []any{nil, (*sampleReq)(nil), &sampleReq{}} {
		p, err := ParseRequestParams(req)
		if err != nil {
			t.Fatal(err)
		}
		if len(p.Query) != 0 || len(p.Header) != 0 {
			t.Errorf("expected empty params, got %+v", p)
		}
	}
}

func TestParseRequestParamsNonStruct(t *testing.T) {
	if _, err := ParseRequestParams(Ptr(42)); err == nil {
		t.Fatal("expected error for non-struct request")
	}
}
