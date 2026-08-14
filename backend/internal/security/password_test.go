package security

import "testing"

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		username string
		wantErr  bool
	}{
		{name: "valid passphrase", password: "a-long-random-passphrase", username: "admin"},
		{name: "unicode length", password: "安全密码足够长十二个字符以上", username: "admin"},
		{name: "too short", password: "short", username: "admin", wantErr: true},
		{name: "too common", password: "password1234", username: "admin", wantErr: true},
		{name: "contains username", password: "prefix-admin-secret", username: "admin", wantErr: true},
		{name: "exceeds bcrypt byte limit", password: "这是一个超过bcrypt字节上限的非常非常长的安全密码短语", username: "admin", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePassword(tt.password, tt.username)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ValidatePassword() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
