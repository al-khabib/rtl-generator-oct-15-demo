import * as vscode from 'vscode';
import { TextEncoder } from 'util';
import * as path from 'path';
import { detectReactComponent } from './providers/ComponentDetector';
import { ComponentInfo, GeneratedTest } from './types';
import { httpClient } from './utils/httpClient';

const getConfiguration = () => vscode.workspace.getConfiguration('rtlTestGenerator');

const sendToBackend = async (componentInfo: ComponentInfo): Promise<GeneratedTest> => {
  return httpClient.generateTest(componentInfo);
};

const saveGeneratedTest = async (
  generatedTest: GeneratedTest,
  componentInfo: ComponentInfo
): Promise<vscode.Uri> => {
  const configuration = getConfiguration();
  const outputDirectorySetting = configuration.get<string>('testOutputDirectory') ?? '__tests__';
  const autoSaveEnabled = configuration.get<boolean>('autoSaveGeneratedTests') ?? false;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(componentInfo.filePath));

  const defaultFileName = `${componentInfo.name}.test.tsx`;
  const fileName = generatedTest.fileName ?? defaultFileName;

  if (!autoSaveEnabled) {
    const document = await vscode.workspace.openTextDocument({
      content: generatedTest.content,
      language:
        fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? 'typescriptreact' : 'typescript'
    });
    await vscode.window.showTextDocument(document, { preview: false });
    return document.uri;
  }

  const componentDirectory = path.dirname(componentInfo.filePath);
  const targetDirectory = path.isAbsolute(outputDirectorySetting)
    ? outputDirectorySetting
    : path.join(componentDirectory, outputDirectorySetting);

  const targetDirectoryUri = vscode.Uri.file(targetDirectory);
  await vscode.workspace.fs.createDirectory(targetDirectoryUri);

  const fileUri = vscode.Uri.file(path.join(targetDirectory, fileName));

  let shouldWrite = true;
  try {
    await vscode.workspace.fs.stat(fileUri);
    const overwrite = await vscode.window.showWarningMessage(
      `A test file already exists at ${fileUri.fsPath}. Overwrite?`,
      { modal: true },
      'Overwrite',
      'Cancel'
    );
    shouldWrite = overwrite === 'Overwrite';
  } catch {
    // File does not exist; safe to write.
  }

  if (!shouldWrite) {
    throw new Error('Operation cancelled by user.');
  }

  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(fileUri, encoder.encode(generatedTest.content));
  const document = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(document, { preview: false });

  return fileUri;
};

const validateDocument = async (uri?: vscode.Uri): Promise<vscode.TextDocument> => {
  if (uri) {
    return vscode.workspace.openTextDocument(uri);
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document) {
    return activeEditor.document;
  }

  throw new Error('No active editor or file selected.');
};

export function activate(context: vscode.ExtensionContext) {
  const generateTestCommand = vscode.commands.registerCommand(
    'rtl-generator.generateTest',
    async (resource?: vscode.Uri) => {
      let document: vscode.TextDocument;

      try {
        document = await validateDocument(resource);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to read the selected file.';
        vscode.window.showErrorMessage(message);
        return;
      }

      const isReactFile =
        document.languageId === 'javascriptreact' ||
        document.languageId === 'typescriptreact' ||
        /\.tsx?$/.test(document.fileName) ||
        /\.jsx$/.test(document.fileName);

      if (!isReactFile) {
        vscode.window.showWarningMessage('Generate RTL Test supports only React component files.');
        return;
      }

      let componentInfo: ComponentInfo | null = null;

      try {
        componentInfo = await detectReactComponent(document);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to analyze the component.';
        vscode.window.showErrorMessage(message);
        return;
      }

      if (!componentInfo) {
        vscode.window.showWarningMessage(
          'No React component detected in the selected file.'
        );
        return;
      }

      if (componentInfo.hasTests) {
        const decision = await vscode.window.showInformationMessage(
          `Existing tests detected for ${componentInfo.name}. Generate a new test anyway?`,
          { modal: true },
          'Continue',
          'Cancel'
        );

        if (decision !== 'Continue') {
          return;
        }
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Generating RTL test for ${componentInfo.name}`,
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: 'Checking service availability…' });

          try {
            await httpClient.checkHealth();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Service health check failed.';
            vscode.window.showErrorMessage(message);
            return;
          }

          progress.report({ message: 'Sending component data…' });

          try {
            const generatedTest = await sendToBackend(componentInfo);
            progress.report({ message: 'Preparing test output…' });
            await saveGeneratedTest(generatedTest, componentInfo);
            vscode.window.showInformationMessage(
              `Generated RTL test for ${componentInfo.name}.`
            );
          } catch (error) {
            if (error instanceof Error && error.message === 'Operation cancelled by user.') {
              vscode.window.showInformationMessage('RTL test generation cancelled.');
              return;
            }
            const message =
              error instanceof Error ? error.message : 'Failed to generate RTL test.';
            vscode.window.showErrorMessage(message);
          }
        }
      );
    }
  );

  context.subscriptions.push(generateTestCommand);
}

export function deactivate() {
  // Intentionally left blank.
}
