package genlib

import "testing"

// A prefixed name derived in one group must not steal another group's base
// name: with defs {CB, C.B, D.B}, resolving C.B would produce "CB", which is
// reserved for the CB definition — that must be an error, while D.B still
// resolves to "DB".
func TestDefGoNamesCrossGroupReservation(t *testing.T) {
	if _, err := defGoNames([]string{"CB", "C.B", "D.B"}, &Config{}, map[string]bool{}); err == nil {
		t.Fatal("expected naming conflict error for C.B vs CB")
	}
	names, err := defGoNames([]string{"CB", "D.B", "E.B"}, &Config{}, map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if names["CB"] != "CB" || names["D.B"] != "DB" || names["E.B"] != "EB" {
		t.Errorf("names = %v", names)
	}
}

func TestMethodNameStripSuffix(t *testing.T) {
	cfg := &Config{StripOperationIDSuffix: "Method"}
	if got := methodName("GET", "/x", "CreateCampaignMethod", cfg); got != "CreateCampaign" {
		t.Errorf("got %q", got)
	}
	cfg.Rename = map[string]string{"CreateCampaignMethod": "MakeCampaign"}
	if got := methodName("GET", "/x", "CreateCampaignMethod", cfg); got != "MakeCampaign" {
		t.Errorf("rename must win, got %q", got)
	}
}

func TestDefGoNamesForbiddenBase(t *testing.T) {
	names, err := defGoNames([]string{"Api.V1.Foo"}, &Config{}, map[string]bool{"Foo": true})
	if err != nil {
		t.Fatal(err)
	}
	if names["Api.V1.Foo"] != "V1Foo" {
		t.Errorf("names = %v", names)
	}
}
