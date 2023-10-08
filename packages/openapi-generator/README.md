# Openapi generator for comet

Docs for [comet](https://github.com/neoaren/comet)

## Usage

```bash
npx @comet/openapi-generator
```

## Flags

| Flag          | Description        | Default                    |
|---------------|--------------------|----------------------------|
| -h, --help    | Show help          |                            |
| -o, --output  | Output file        | ./openapi.json             |
| -i, --input   | Input worker file  | ./src/worker.ts            |
| -t, --title   | Title of the API   | ./package.json/name        |
| -v, --version | Version of the API | ./package.json/version     |
| -d, --debug   | Debug mode         | false                      |
| -s, --silent  | Silent mode        | false                      |
| -e, --export  | Export name        | anything found but default |
