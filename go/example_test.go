package chert_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"

	chert "github.com/cherthq/sdk/go"
)

func ExampleNew() {
	sdk, err := chert.New(chert.SDKConfig{
		IMessage: &chert.Config{APIKey: "your-imessage-key", Tenant: "your-imessage-tenant"},
		FaceTime: &chert.FaceTimeConfig{Token: "your-facetime-token", ProjectID: "your-facetime-project"},
	})
	if err != nil {
		panic(err)
	}
	// Constructors send nothing. Production endpoints require no URL configuration.
	fmt.Println(sdk.IMessage != nil, sdk.FaceTime != nil)
	// Output: true true
}

func ExampleFaceTimeClient_ListLines() {
	// A test/self-hosted endpoint override; omit it for production.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fmt.Fprint(w, `{"data":{"items":[{"id":"line-1","display_name":"Example","status":"available","supports_audio":true,"supports_video":false}],"total":1,"limit":25,"offset":0},"request_id":"example-request"}`); err != nil {
			panic(err)
		}
	}))
	defer server.Close()
	client, err := chert.NewFaceTimeClient(chert.FaceTimeConfig{
		Token: "test-token", ProjectID: "test-project", EndpointOverride: server.URL,
	})
	if err != nil {
		panic(err)
	}
	result, err := client.ListLines(context.Background(), chert.PageOptions{Limit: 25})
	if err != nil {
		panic(err)
	}
	fmt.Println(result.Data.Items[0].ID, result.Data.Items[0].SupportsVideo, result.Response.RequestID)
	// Output: line-1 false example-request
}
