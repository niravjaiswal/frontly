/**
 * Chat Component
 *
 * Displays the scrollable chat history with markdown rendering
 * for assistant messages.
 */

import React from 'react';
import { Box, Text, Static } from 'ink';
import type { ChatMessage } from '../types.js';

interface ChatProps {
  messages: ChatMessage[];
  isLoading: boolean;
}

export function Chat({ messages, isLoading }: ChatProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Static messages to prevent re-rendering */}
      <Static items={messages.map((msg, i) => ({ ...msg, id: i }))}>
        {(message) => (
          <MessageBubble key={message.id} message={message} />
        )}
      </Static>

      {/* Loading indicator */}
      {isLoading && (
        <Box marginTop={1}>
          <Text color="cyan">
            <LoadingSpinner /> Thinking...
          </Text>
        </Box>
      )}
    </Box>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content } = message;

  // Role indicator and color
  const roleConfig = {
    user: { label: 'You', color: 'green' as const },
    assistant: { label: 'Frontly', color: 'cyan' as const },
    system: { label: 'System', color: 'yellow' as const },
  };

  const config = roleConfig[role];

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={config.color} bold>
        {config.label}:
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <FormattedContent content={content} role={role} />
      </Box>
    </Box>
  );
}

interface FormattedContentProps {
  content: string;
  role: ChatMessage['role'];
}

/**
 * Renders content with basic markdown-like formatting
 */
function FormattedContent({ content, role }: FormattedContentProps) {
  // For user messages, render plain text
  if (role === 'user') {
    return <Text>{content}</Text>;
  }

  // For assistant/system messages, apply basic formatting
  const lines = content.split('\n');

  return (
    <>
      {lines.map((line, index) => (
        <FormattedLine key={index} line={line} />
      ))}
    </>
  );
}

interface FormattedLineProps {
  line: string;
}

function FormattedLine({ line }: FormattedLineProps) {
  // Empty line
  if (!line.trim()) {
    return <Text> </Text>;
  }

  // Headers
  if (line.startsWith('## ')) {
    return (
      <Text bold color="white">
        {line.slice(3)}
      </Text>
    );
  }

  if (line.startsWith('# ')) {
    return (
      <Text bold color="white">
        {line.slice(2)}
      </Text>
    );
  }

  // Bold text with **
  if (line.includes('**')) {
    return <TextWithBold text={line} />;
  }

  // List items
  if (line.match(/^\s*[-+*]\s/)) {
    const indent = line.match(/^(\s*)/)?.[1] || '';
    const content = line.replace(/^\s*[-+*]\s/, '');
    return (
      <Text>
        {indent}• {content}
      </Text>
    );
  }

  // Code blocks (simplified - just dim the text)
  if (line.startsWith('```')) {
    return <Text color="gray">{line}</Text>;
  }

  // Inline code with backticks
  if (line.includes('`')) {
    return <TextWithCode text={line} />;
  }

  // Regular text
  return <Text>{line}</Text>;
}

/**
 * Renders text with **bold** sections
 */
function TextWithBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/);

  return (
    <Text>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={i} bold>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

/**
 * Renders text with `code` sections
 */
function TextWithCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/);

  return (
    <Text>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <Text key={i} color="yellow">
              {part.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

/**
 * Simple loading spinner component
 */
function LoadingSpinner() {
  const [frame, setFrame] = React.useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  React.useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <Text color="cyan">{frames[frame]}</Text>;
}
