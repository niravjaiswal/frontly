/**
 * Gemini API Client
 *
 * Handles communication with the Google Gemini API.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, createPromptWithContext } from './prompts.js';
import type { ChatMessage, ExecutionPlan, GeminiResponse } from '../types.js';

// Singleton instance
let genAI: GoogleGenerativeAI | null = null;

/**
 * Initialize the Gemini client
 */
export function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Sends a message to Gemini and returns the response
 */
export async function sendMessage(
  userMessage: string,
  chatHistory: ChatMessage[],
  repoSummary: string
): Promise<GeminiResponse> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: 'gemini-1.5-pro',
    systemInstruction: SYSTEM_PROMPT,
  });

  // Create the full prompt with context
  const prompt = createPromptWithContext(userMessage, repoSummary, chatHistory);

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    return {
      text,
    };
  } catch (error) {
    if (error instanceof Error) {
      // Handle specific API errors
      if (error.message.includes('API key')) {
        throw new Error('Invalid API key. Please check your GEMINI_API_KEY.');
      }
      if (error.message.includes('quota')) {
        throw new Error('API quota exceeded. Please try again later.');
      }
      throw error;
    }
    throw new Error('Unknown error communicating with Gemini API');
  }
}

/**
 * Parses a Gemini response to extract plan or regular text
 */
export function parseResponse(responseText: string): {
  text: string;
  plan: ExecutionPlan | null;
} {
  // Look for a JSON plan block
  const planMatch = responseText.match(/```json:plan\s*([\s\S]*?)```/);

  if (planMatch) {
    try {
      const planJson = planMatch[1].trim();
      const plan = JSON.parse(planJson) as ExecutionPlan;

      // Validate the plan structure
      if (validatePlan(plan)) {
        // Return the text without the plan block, plus the parsed plan
        const textWithoutPlan = responseText
          .replace(/```json:plan\s*[\s\S]*?```/, '')
          .trim();

        return {
          text: textWithoutPlan || 'Here is the execution plan:',
          plan,
        };
      }
    } catch {
      // JSON parsing failed, treat as regular response
    }
  }

  return {
    text: responseText,
    plan: null,
  };
}

/**
 * Validates an execution plan structure
 */
function validatePlan(plan: unknown): plan is ExecutionPlan {
  if (!plan || typeof plan !== 'object') return false;

  const p = plan as Record<string, unknown>;

  // Check required fields
  if (typeof p.reasoning !== 'string') return false;
  if (!Array.isArray(p.files_to_create)) return false;
  if (!Array.isArray(p.files_to_modify)) return false;
  if (!Array.isArray(p.files_to_delete)) return false;

  // Validate file entries
  for (const file of p.files_to_create as unknown[]) {
    if (!isValidFileEntry(file)) return false;
  }

  for (const file of p.files_to_modify as unknown[]) {
    if (!isValidFileEntry(file)) return false;
  }

  for (const file of p.files_to_delete as unknown[]) {
    if (typeof file !== 'string') return false;
  }

  return true;
}

/**
 * Validates a file entry in a plan
 */
function isValidFileEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  return typeof e.path === 'string' && typeof e.description === 'string';
}

/**
 * Sends a request for file content after plan approval
 */
export async function requestFileContent(
  filePath: string,
  description: string,
  chatHistory: ChatMessage[],
  repoSummary: string,
  existingContent?: string
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: 'gemini-1.5-pro',
    systemInstruction: `You are a code generator. When asked for file content, respond with ONLY the raw file content.
Do not include any explanations, markdown formatting, or code blocks.
Just output the exact content that should be written to the file.`,
  });

  const prompt = existingContent
    ? `Generate the updated content for ${filePath}.
Purpose: ${description}

Current content:
${existingContent}

Respond with ONLY the complete updated file content.`
    : `Generate the content for new file ${filePath}.
Purpose: ${description}

Respond with ONLY the file content.`;

  const result = await model.generateContent(prompt);
  let content = result.response.text();

  // Strip any accidental markdown code blocks
  content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

  return content;
}
