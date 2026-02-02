/**
 * Input Component
 *
 * Single-line text input at the bottom of the chat interface.
 * Handles user input and submission.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  onSubmit: (value: string) => void;
  isDisabled?: boolean;
  placeholder?: string;
}

export function Input({
  onSubmit,
  isDisabled = false,
  placeholder = 'Type a message...',
}: InputProps) {
  const [value, setValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  useInput(
    (input, key) => {
      if (isDisabled) return;

      // Handle Enter key - submit
      if (key.return) {
        if (value.trim()) {
          onSubmit(value);
          setValue('');
          setCursorPosition(0);
        }
        return;
      }

      // Handle backspace
      if (key.backspace || key.delete) {
        if (cursorPosition > 0) {
          setValue((prev) =>
            prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition)
          );
          setCursorPosition((prev) => prev - 1);
        }
        return;
      }

      // Handle left arrow
      if (key.leftArrow) {
        setCursorPosition((prev) => Math.max(0, prev - 1));
        return;
      }

      // Handle right arrow
      if (key.rightArrow) {
        setCursorPosition((prev) => Math.min(value.length, prev + 1));
        return;
      }

      // Handle Ctrl+A - go to start
      if (key.ctrl && input === 'a') {
        setCursorPosition(0);
        return;
      }

      // Handle Ctrl+E - go to end
      if (key.ctrl && input === 'e') {
        setCursorPosition(value.length);
        return;
      }

      // Handle Ctrl+U - clear line
      if (key.ctrl && input === 'u') {
        setValue('');
        setCursorPosition(0);
        return;
      }

      // Handle Ctrl+W - delete word
      if (key.ctrl && input === 'w') {
        const beforeCursor = value.slice(0, cursorPosition);
        const afterCursor = value.slice(cursorPosition);
        const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
        const newBeforeCursor =
          lastSpaceIndex === -1 ? '' : beforeCursor.slice(0, lastSpaceIndex);
        setValue(newBeforeCursor + afterCursor);
        setCursorPosition(newBeforeCursor.length);
        return;
      }

      // Handle regular character input
      if (input && !key.ctrl && !key.meta) {
        setValue((prev) =>
          prev.slice(0, cursorPosition) + input + prev.slice(cursorPosition)
        );
        setCursorPosition((prev) => prev + input.length);
      }
    },
    { isActive: !isDisabled }
  );

  // Render the input with cursor
  const displayValue = value || (isDisabled ? '' : placeholder);
  const showPlaceholder = !value && !isDisabled;

  return (
    <Box
      borderStyle="round"
      borderColor={isDisabled ? 'gray' : 'cyan'}
      paddingX={1}
      marginTop={1}
    >
      <Text color="cyan" bold>
        {'> '}
      </Text>
      {showPlaceholder ? (
        <Text color="gray" dimColor>
          {placeholder}
        </Text>
      ) : (
        <TextWithCursor
          text={value}
          cursorPosition={cursorPosition}
          isDisabled={isDisabled}
        />
      )}
    </Box>
  );
}

interface TextWithCursorProps {
  text: string;
  cursorPosition: number;
  isDisabled: boolean;
}

function TextWithCursor({ text, cursorPosition, isDisabled }: TextWithCursorProps) {
  if (isDisabled) {
    return <Text color="gray">{text}</Text>;
  }

  const beforeCursor = text.slice(0, cursorPosition);
  const atCursor = text[cursorPosition] || ' ';
  const afterCursor = text.slice(cursorPosition + 1);

  return (
    <Text>
      {beforeCursor}
      <Text backgroundColor="white" color="black">
        {atCursor}
      </Text>
      {afterCursor}
    </Text>
  );
}
