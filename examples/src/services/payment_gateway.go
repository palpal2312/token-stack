package services

import (
	"net/http"
	"time"
)

func ProcessPayment(amount int) (*http.Response, error) {
	// BUG: missing timeout context on default client
	client := &http.Client{}
	return client.Get("https://api.payment.local/charge")
}