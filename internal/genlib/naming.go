package genlib

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
)

// camelize turns an arbitrary wire name into an exported Go identifier:
// split on non-alphanumeric runes, capitalize each part, join.
// "x-trace" → "XTrace", "startDate" → "StartDate", "request.ids" → "RequestIds".
func camelize(name string) string {
	var b strings.Builder
	upperNext := true
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			upperNext = true
			continue
		}
		if upperNext {
			r = unicode.ToUpper(r)
			upperNext = false
		}
		b.WriteRune(r)
	}
	s := b.String()
	if s == "" {
		return "X"
	}
	if unicode.IsDigit(rune(s[0])) {
		return "X" + s
	}
	return s
}

// methodName derives a Go method name from an operationId. Config renames
// apply first, keyed either by "METHOD /path" (for specs with duplicate
// operationIds) or by operationId.
func methodName(httpMethod, path, operationID string, cfg *Config) string {
	if n, ok := cfg.Rename[httpMethod+" "+path]; ok {
		return n
	}
	if n, ok := cfg.Rename[operationID]; ok {
		return n
	}
	return camelize(operationID)
}

// refName extracts a component schema name from a $ref.
func refName(ref string) string {
	return strings.TrimPrefix(ref, "#/components/schemas/")
}

// lastSegment returns the part after the final dot of a definition name.
func lastSegment(full string) string {
	if i := strings.LastIndex(full, "."); i >= 0 {
		return full[i+1:]
	}
	return full
}

// preferred reports whether a full definition name lives under one of the
// configured preferred namespaces.
func preferred(full string, cfg *Config) bool {
	for _, ns := range cfg.PreferNamespaces {
		if strings.HasPrefix(full, ns+".") {
			return true
		}
	}
	return false
}

// defGoNames assigns a unique Go type name to every definition. The base
// name is the camelized last segment. On collision, definitions under a
// preferred namespace keep the base name; the others prepend namespace
// segments right-to-left until unique. forbidden holds names reserved for
// generated request structs.
func defGoNames(fullNames []string, cfg *Config, forbidden map[string]bool) (map[string]string, error) {
	names := map[string]string{}
	groups := map[string][]string{}
	for _, full := range fullNames {
		if renamed, ok := cfg.RenameTypes[full]; ok {
			names[full] = renamed
			forbidden[renamed] = true
			continue
		}
		base := camelize(lastSegment(full))
		groups[base] = append(groups[base], full)
	}
	for base, group := range groups {
		sort.Strings(group)
		if err := assignGroup(base, group, cfg, forbidden, names); err != nil {
			return nil, err
		}
	}
	return names, nil
}

func assignGroup(base string, group []string, cfg *Config, forbidden map[string]bool, names map[string]string) error {
	taken := map[string]bool{}
	for name := range forbidden {
		taken[name] = true
	}
	for _, full := range group {
		if len(group) == 1 || preferred(full, cfg) {
			if !taken[base] {
				names[full] = base
				taken[base] = true
				continue
			}
		}
		name, err := prefixedName(full, base, taken)
		if err != nil {
			return err
		}
		names[full] = name
		taken[name] = true
	}
	return nil
}

// prefixedName prepends namespace segments right-to-left until the name is
// unique: "Acme.Common.Tag" → "CommonTag" → "AcmeCommonTag".
func prefixedName(full, base string, taken map[string]bool) (string, error) {
	segments := strings.Split(full, ".")
	name := base
	for i := len(segments) - 2; i >= 0; i-- {
		name = camelize(segments[i]) + name
		if !taken[name] {
			return name, nil
		}
	}
	return "", fmt.Errorf("genlib: cannot derive unique Go name for definition %q", full)
}
