# rtl-test-generator

Project is a vs code extension to automatically generate RTL Unit tests for React UI components.

## Architecture:

```
rtl-test-generator/
├── extension/                  # VS Code Extension
│   ├── src/
│   │   ├── extension.ts       # Main extension entry
│   │   ├── commands/
│   │   ├── providers/
│   │   └── webview/           # React-based webview
│   ├── package.json
│   └── tsconfig.json
├── services/
│   ├── api-gateway/           # Main API Gateway
│   ├── code-analysis/
│   ├── llm-service/
│   └── test-validation/
├── shared/
├── docker-compose.yml
└── README.md
```

## Run the app

To run the app you need a Docker and Docker Compose available on your machine. The easiest way to have them both is to install Docker Desktop application [DOcker Installation](https://docs.docker.com/desktop/setup/install/windows-install/)

1. Once you have Docker Desktop on your machine, run the application.

2. In the root, run `docker compose up --build`

3. Open the `extension` folder in a separate Vscode window e.g. by running `code extension` in the root

4. On the new Vscode Window (where the extension is the root) press `F5` on the keyboard.

You also need [Ollama](https://ollama.com/download/windows?_sm_vck=fVj5sw65kLNf5q2654WrW47N2F224qFrFq0JJqPRQ6qHwrrj4qPM)
