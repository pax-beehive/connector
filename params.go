package connector

import (
	"fmt"
	"net/url"
	"reflect"
	"strconv"
)

// RequestParams holds the HTTP-level parameters extracted from a tagged
// request struct.
type RequestParams struct {
	Query  url.Values
	Path   map[string]string
	Header map[string]string
}

// ParseRequestParams walks the struct pointed to by req and collects fields
// tagged `query:"wire.name"`, `path:"name"`, `header:"Name"`. Nil pointer
// fields are skipped; slices produce one query value per element; values are
// formatted via fmt.Stringer if implemented, else by kind. req may be nil.
func ParseRequestParams(req any) (*RequestParams, error) {
	p := &RequestParams{Query: url.Values{}, Path: map[string]string{}, Header: map[string]string{}}
	if req == nil {
		return p, nil
	}
	v := reflect.ValueOf(req)
	for v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return p, nil
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return nil, fmt.Errorf("connector: request must be a struct, got %T", req)
	}
	if err := p.walkStruct(v); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *RequestParams) walkStruct(v reflect.Value) error {
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		if err := p.field(t.Field(i), v.Field(i)); err != nil {
			return err
		}
	}
	return nil
}

func (p *RequestParams) field(sf reflect.StructField, fv reflect.Value) error {
	name, kind := paramTag(sf)
	if name == "" {
		return nil
	}
	for fv.Kind() == reflect.Pointer {
		if fv.IsNil() {
			return nil
		}
		fv = fv.Elem()
	}
	if kind == "query" && fv.Kind() == reflect.Slice {
		for i := 0; i < fv.Len(); i++ {
			s, err := formatValue(fv.Index(i))
			if err != nil {
				return err
			}
			p.Query.Add(name, s)
		}
		return nil
	}
	s, err := formatValue(fv)
	if err != nil {
		return err
	}
	switch kind {
	case "query":
		p.Query.Add(name, s)
	case "path":
		p.Path[name] = s
	case "header":
		p.Header[name] = s
	}
	return nil
}

func paramTag(sf reflect.StructField) (name, kind string) {
	for _, k := range []string{"query", "path", "header"} {
		if tag, ok := sf.Tag.Lookup(k); ok && tag != "" {
			return tag, k
		}
	}
	return "", ""
}

func formatValue(v reflect.Value) (string, error) {
	if s, ok := v.Interface().(fmt.Stringer); ok {
		return s.String(), nil
	}
	switch v.Kind() {
	case reflect.String:
		return v.String(), nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.FormatInt(v.Int(), 10), nil
	case reflect.Float32:
		return strconv.FormatFloat(v.Float(), 'f', -1, 32), nil
	case reflect.Float64:
		return strconv.FormatFloat(v.Float(), 'f', -1, 64), nil
	case reflect.Bool:
		return strconv.FormatBool(v.Bool()), nil
	default:
		return "", fmt.Errorf("connector: unsupported parameter type %s", v.Type())
	}
}
