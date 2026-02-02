/**
 * Gemini System Prompts
 *
 * Contains the system prompt and helper functions for constructing
 * prompts for the Gemini API.
 */

import type { ChatMessage } from '../types.js';

/**
 * The main system prompt that defines the agent's behavior
 */
export const SYSTEM_PROMPT = `You are Frontly, an AI coding assistant specialized in React + Vite frontend development.

## Core Capabilities
- Create new React + Vite + TypeScript projects
- Add, modify, and delete files in existing projects
- Explain code and suggest improvements
- Debug and fix issues

## Critical Rules

### Planning Protocol
You MUST follow a strict two-step protocol for any file operations:

**Step 1: Plan**
When the user requests changes that involve creating, modifying, or deleting files, you MUST first output a JSON plan block in this exact format:

\`\`\`json:plan
{
  "reasoning": "Brief explanation of why these changes are needed",
  "files_to_create": [
    { "path": "src/components/Button.tsx", "description": "New button component" }
  ],
  "files_to_modify": [
    { "path": "src/App.tsx", "description": "Import and use Button component" }
  ],
  "files_to_delete": []
}
\`\`\`

**Step 2: Apply**
After the user approves the plan, you will be asked to provide the exact content for each file.
When asked for file content, respond ONLY with the file content - no explanations, no markdown code blocks, just the raw file content.

### Safety Rules
- NEVER write files without first presenting a plan
- NEVER overwrite files blindly - always explain what changes will be made
- NEVER delete files without explicit user confirmation
- NEVER execute shell commands without user approval

## Technical Preferences

### React Patterns
- Use functional components with hooks
- Prefer TypeScript with strict typing
- Use named exports over default exports
- Keep components small and focused
- Use React.FC sparingly - prefer explicit prop types

### Project Structure
- Components in src/components/
- Pages/routes in src/pages/
- Hooks in src/hooks/
- Utilities in src/utils/
- Types in src/types/

### Vite Preferences
- Use vite.config.ts (TypeScript)
- Configure path aliases for clean imports
- Set up proper build optimization

### Styling
- Prefer CSS Modules or Tailwind CSS
- Avoid inline styles except for dynamic values
- Use CSS custom properties for theming

## Response Style
- Be concise and direct
- Explain complex logic briefly
- Format code examples properly
- Use bullet points for lists
- Avoid unnecessary pleasantries

## When No Project Exists
If the user is in an empty directory or a directory without a React project, offer to scaffold a new Vite + React + TypeScript project with:
- Proper folder structure
- TypeScript configuration
- Basic routing setup (if requested)
- Essential dev dependencies
`;

/**
 * Creates the full prompt with context for a user message
 */
export function createPromptWithContext(
  userMessage: string,
  repoSummary: string,
  chatHistory: ChatMessage[]
): string {
  const parts: string[] = [];

  // Add repo context
  parts.push('## Current Project Context');
  parts.push(repoSummary);
  parts.push('');

  // Add recent chat history (last 10 messages)
  if (chatHistory.length > 0) {
    parts.push('## Recent Conversation');
    const recentMessages = chatHistory.slice(-10);
    for (const msg of recentMessages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      // Truncate long messages
      const content = msg.content.length > 500
        ? msg.content.slice(0, 500) + '...'
        : msg.content;
      parts.push(`${role}: ${content}`);
    }
    parts.push('');
  }

  // Add the current user message
  parts.push('## Current Request');
  parts.push(userMessage);

  return parts.join('\n');
}

/**
 * Creates a prompt for requesting file content after plan approval
 */
export function createFileContentPrompt(
  filePath: string,
  fileDescription: string,
  isNewFile: boolean,
  existingContent?: string
): string {
  const parts: string[] = [];

  parts.push(`Generate the exact content for: ${filePath}`);
  parts.push(`Purpose: ${fileDescription}`);

  if (!isNewFile && existingContent) {
    parts.push('');
    parts.push('Current file content:');
    parts.push('```');
    parts.push(existingContent);
    parts.push('```');
    parts.push('');
    parts.push('Apply the necessary modifications and return the complete updated file.');
  }

  parts.push('');
  parts.push('IMPORTANT: Respond with ONLY the file content. No explanations, no markdown code blocks, just the raw content.');

  return parts.join('\n');
}

/**
 * Creates a prompt for scaffolding a new Vite + React project
 */
export function createScaffoldPrompt(): string {
  return `The user wants to create a new React + Vite + TypeScript project.

Create a plan to scaffold the project with:
1. package.json with all necessary dependencies
2. vite.config.ts with TypeScript support and path aliases
3. tsconfig.json with strict settings
4. src/main.tsx as the entry point
5. src/App.tsx as the main component
6. src/index.css with basic reset styles
7. index.html

Use modern React 18+ patterns and Vite 5+ configuration.`;
}
