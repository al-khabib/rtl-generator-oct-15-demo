import * as vscode from 'vscode';

/**
 * Activates the extension. Registers commands and displays an activation message.
 */
export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('RTL Test Generator activated successfully.');

  const generateTestCommand = vscode.commands.registerCommand(
    'rtl-generator.generateTest',
    async () => {
      await vscode.window.showInformationMessage('Generate RTL Test command executed.');
    }
  );

  context.subscriptions.push(generateTestCommand);
}

/**
 * Clean up any lingering resources when the extension is deactivated.
 */
export function deactivate() {
  // No resources to clean up yet.
}
