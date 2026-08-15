COVERAGE_MIN ?= 80.0
COMPLEXITY_MAX ?= 20
QUALITY_GATE := go run ./cmd/qualitygate

.PHONY: gen lint test test-race cover quality

gen:
	go generate ./...

lint:
	go vet ./...
	$(QUALITY_GATE) -max-complexity $(COMPLEXITY_MAX) .

test:
	go test -count=1 ./...

test-race:
	go test -count=1 -race ./...

cover:
	go test -count=1 ./... -coverprofile=coverage.out
	@go tool cover -func=coverage.out | awk -v min=$(COVERAGE_MIN) '/^total:/{found=1; gsub(/%/,"",$$3); coverage=$$3} END{if (!found) {print "FAIL: total coverage was not reported"; exit 1}; printf "total coverage: %.1f%% (minimum %.1f%%)\n", coverage, min; if (coverage+0 < min) exit 1}'

quality: lint test-race cover
