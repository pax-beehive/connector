GOCYCLO := go run github.com/fzipp/gocyclo/cmd/gocyclo@v0.6.0

.PHONY: gen lint test cover

gen:
	go generate ./...

lint:
	go vet ./...
	$(GOCYCLO) -over 19 .

test:
	go test ./...

cover:
	go test ./... -coverprofile=coverage.out
	@go tool cover -func=coverage.out | tail -1
	@go tool cover -func=coverage.out | tail -1 | awk '{gsub(/%/,"",$$3); if ($$3+0 < 80.0) {print "FAIL: coverage " $$3 "% is below 80%"; exit 1}}'
