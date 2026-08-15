package qualitygate

import (
	"fmt"
	"unicode/utf8"
)

func checkText(path string, data []byte) []Violation {
	if !utf8.Valid(data) {
		return []Violation{{Path: path, Line: 1, Rule: "source-language", Message: "source is not valid UTF-8"}}
	}
	line := 1
	var violations []Violation
	for _, r := range string(data) {
		if isHan(r) {
			violations = append(violations, Violation{
				Path: path, Line: line, Rule: "source-language",
				Message: fmt.Sprintf("Chinese character U+%04X is not allowed in source or comments", r),
			})
		}
		if isEmoji(r) {
			violations = append(violations, Violation{
				Path: path, Line: line, Rule: "source-language",
				Message: fmt.Sprintf("emoji code point U+%04X is not allowed in source or comments", r),
			})
		}
		if r == '\n' {
			line++
		}
	}
	return violations
}

func isHan(r rune) bool {
	return inRange(r, 0x3400, 0x4DBF) ||
		inRange(r, 0x4E00, 0x9FFF) ||
		inRange(r, 0xF900, 0xFAFF) ||
		inRange(r, 0x20000, 0x2FA1F) ||
		inRange(r, 0x30000, 0x323AF)
}

func isEmoji(r rune) bool {
	return inRange(r, 0x2300, 0x23FF) ||
		inRange(r, 0x2600, 0x27BF) ||
		inRange(r, 0x2B00, 0x2BFF) ||
		inRange(r, 0x1F000, 0x1FAFF) ||
		r == 0x200D || r == 0x20E3 || r == 0xFE0F
}

func inRange(r, first, last rune) bool {
	return r >= first && r <= last
}
