FROM golang:1.22-alpine AS build

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . ./
RUN go build -o /app/bin/server ./cmd/server

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/bin/server /app/server
EXPOSE 8080
CMD ["/app/server"]
