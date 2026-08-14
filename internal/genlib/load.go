package genlib

import (
	"encoding/json"
	"os"

	"github.com/getkin/kin-openapi/openapi2"
	"github.com/getkin/kin-openapi/openapi2conv"
	"github.com/getkin/kin-openapi/openapi3"
)

// LoadSpec loads an OpenAPI spec file. Swagger 2.0 documents are converted
// to OpenAPI 3.x so the rest of the generator handles a single format.
func LoadSpec(path string) (*openapi3.T, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var sniff struct {
		Swagger string `json:"swagger"`
	}
	if err := json.Unmarshal(data, &sniff); err != nil {
		return nil, err
	}
	if sniff.Swagger == "2.0" {
		var doc2 openapi2.T
		if err := json.Unmarshal(data, &doc2); err != nil {
			return nil, err
		}
		return openapi2conv.ToV3(&doc2)
	}
	return openapi3.NewLoader().LoadFromData(data)
}
