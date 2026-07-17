FROM golang:1.24-alpine AS build

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN go build -o /app/bin/server ./cmd/server

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/bin/server /app/server
EXPOSE 8080
CMD ["/app/server"]
