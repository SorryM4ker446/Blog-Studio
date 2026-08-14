package apiresponse

import "github.com/gin-gonic/gin"

type errorBody struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func Error(c *gin.Context, status int, code, message string) {
	c.JSON(status, errorBody{Error: message, Code: code})
}

func AbortError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, errorBody{Error: message, Code: code})
}

func Message(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"message": message})
}
