/**
 * Main App Component
 *
 * Root component for the Frontly CLI application.
 * Manages global state and coordinates between UI components.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Chat } from './Chat.js';
import { Input } from './Input.js';
import { sendMessage, parseResponse } from '../gemini/client.js';
import { applyPlan } from '../fs/writer.js';
import { formatValidationErrors } from '../fs/validator.js';
import { saveFeatureIntent } from '../intent/feature-intent.js';
import type { ChatMessage, RepoContext, DiffHistory, ExecutionPlan, ValidationResult } from '../types.js';

interface AppProps {
  repoContext: RepoContext;
  repoSummary: string;
  debug: boolean;
}

type AppMode = 'chat' | 'confirm' | 'applying' | 'validation_failed';

export function App({ repoContext, repoSummary, debug }: AppProps) {
  const { exit } = useApp();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastDiff, setLastDiff] = useState<DiffHistory | null>(null);
  const [pendingPlan, setPendingPlan] = useState<ExecutionPlan | null>(null);
  const [mode, setMode] = useState<AppMode>('chat');
  const [error, setError] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);

  // Handle keyboard input for confirmation mode
  useInput(
    (input, key) => {
      if (mode === 'confirm' && pendingPlan) {
        if (input.toLowerCase() === 'y') {
          handleApplyPlan(false);
        } else if (input.toLowerCase() === 'n' || key.escape) {
          setPendingPlan(null);
          setMode('chat');
          addMessage('assistant', 'Plan cancelled. What would you like to do instead?');
        }
      } else if (mode === 'validation_failed' && pendingPlan) {
        if (input.toLowerCase() === 'y') {
          // User wants to apply despite validation errors
          handleApplyPlan(true);
        } else if (input.toLowerCase() === 'n' || key.escape) {
          setPendingPlan(null);
          setValidationResults([]);
          setMode('chat');
          addMessage('assistant', 'Changes cancelled due to validation errors. What would you like to do instead?');
        }
      }
    },
    { isActive: mode === 'confirm' || mode === 'validation_failed' }
  );

  const addMessage = useCallback((role: ChatMessage['role'], content: string) => {
    setMessages((prev) => [
      ...prev,
      { role, content, timestamp: new Date() },
    ]);
  }, []);

  const handleApplyPlan = async (skipValidation: boolean = false) => {
    if (!pendingPlan) return;

    // Capture the last user message as feature intent when applying from confirm mode
    if (mode === 'confirm') {
      const lastUserMessage = messages
        .slice()
        .reverse()
        .find((msg) => msg.role === 'user');
      if (lastUserMessage) {
        try {
          await saveFeatureIntent(lastUserMessage.content, 'chat', repoContext.rootPath);
        } catch (error) {
          // Non-blocking - log error but continue with plan application
          console.error('Failed to save feature intent:', error);
        }
      }
    }

    setMode('applying');
    try {
      const result = await applyPlan(
        pendingPlan,
        repoContext.rootPath,
        async (filePath) => {
          // Request file content from Gemini for each file
          const contentResponse = await sendMessage(
            `Generate the exact content for file: ${filePath}\n\nRespond with ONLY the file content, no explanations or markdown code blocks.`,
            messages,
            repoSummary
          );
          return contentResponse.text;
        },
        { skipValidation }
      );

      if (result.hasValidationErrors && !skipValidation) {
        // Validation failed - show errors and ask user if they want to proceed
        setValidationResults(result.validationResults);
        setMode('validation_failed');
        const errorSummary = formatValidationErrors(result.validationResults);
        addMessage(
          'system',
          `⚠️ **Validation Errors Found**\n${errorSummary}\n\nThe generated code has syntax or type errors.`
        );
        return;
      }

      // Success - files were written
      setLastDiff(result.diffHistory);
      setValidationResults([]);

      const validationSummary = result.validationResults.length > 0
        ? `\n✓ All ${result.validationResults.length} file(s) passed validation`
        : '';

      addMessage(
        'assistant',
        `✓ Applied changes:\n${result.diffHistory.diffs.map((d) => `  ${d.operation}: ${d.path}`).join('\n')}${validationSummary}`
      );
      setPendingPlan(null);
      setMode('chat');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      addMessage('assistant', `✗ Failed to apply changes: ${errorMessage}`);
      setPendingPlan(null);
      setMode('chat');
    }
  };

  const handleCommand = (command: string): boolean => {
    const cmd = command.trim().toLowerCase();

    switch (cmd) {
      case '/exit':
        exit();
        return true;

      case '/clear':
        setMessages([]);
        setError(null);
        return true;

      case '/diff':
        if (lastDiff) {
          const diffSummary = lastDiff.diffs
            .map((d) => {
              const header = `--- ${d.operation.toUpperCase()}: ${d.path} ---`;
              if (d.operation === 'delete') {
                return `${header}\n(file deleted)`;
              }
              return `${header}\n${d.after.slice(0, 500)}${d.after.length > 500 ? '\n... (truncated)' : ''}`;
            })
            .join('\n\n');
          addMessage('system', `Last changes (${lastDiff.timestamp.toLocaleTimeString()}):\n\n${diffSummary}`);
        } else {
          addMessage('system', 'No recent changes to show.');
        }
        return true;

      default:
        return false;
    }
  };

  const handleSubmit = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Check for commands
    if (trimmed.startsWith('/')) {
      if (handleCommand(trimmed)) return;
    }

    // Add user message
    addMessage('user', trimmed);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessage(trimmed, messages, repoSummary);
      const parsed = parseResponse(response.text);

      if (parsed.plan) {
        // We got an execution plan - show it and ask for confirmation
        setPendingPlan(parsed.plan);
        setMode('confirm');
        addMessage('assistant', formatPlanSummary(parsed.plan));
      } else {
        // Regular response
        addMessage('assistant', parsed.text);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      addMessage('assistant', `Error: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Chat history */}
      <Chat messages={messages} isLoading={isLoading} />

      {/* Confirmation prompt for plans */}
      {mode === 'confirm' && pendingPlan && (
        <Box marginTop={1} paddingX={1}>
          <Text color="yellow">Apply these changes? (y/n): </Text>
        </Box>
      )}

      {/* Validation failed prompt */}
      {mode === 'validation_failed' && pendingPlan && (
        <Box marginTop={1} paddingX={1}>
          <Text color="red">Apply changes despite validation errors? (y/n): </Text>
        </Box>
      )}

      {/* Applying indicator */}
      {mode === 'applying' && (
        <Box marginTop={1} paddingX={1}>
          <Text color="cyan">⏳ Applying changes...</Text>
        </Box>
      )}

      {/* Error display */}
      {error && (
        <Box marginTop={1} paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Input field */}
      {mode === 'chat' && (
        <Input onSubmit={handleSubmit} isDisabled={isLoading} />
      )}

      {/* Debug info */}
      {debug && (
        <Box marginTop={1} paddingX={1}>
          <Text color="gray" dimColor>
            [Debug] Messages: {messages.length} | Mode: {mode} | Loading: {isLoading.toString()}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Formats an execution plan for display
 */
function formatPlanSummary(plan: ExecutionPlan): string {
  const lines: string[] = [];

  lines.push('📋 **Execution Plan**\n');
  lines.push(`**Reasoning:** ${plan.reasoning}\n`);

  if (plan.files_to_create.length > 0) {
    lines.push('**Files to create:**');
    for (const file of plan.files_to_create) {
      lines.push(`  + ${file.path}: ${file.description}`);
    }
    lines.push('');
  }

  if (plan.files_to_modify.length > 0) {
    lines.push('**Files to modify:**');
    for (const file of plan.files_to_modify) {
      lines.push(`  ~ ${file.path}: ${file.description}`);
    }
    lines.push('');
  }

  if (plan.files_to_delete.length > 0) {
    lines.push('**Files to delete:**');
    for (const file of plan.files_to_delete) {
      lines.push(`  - ${file}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
