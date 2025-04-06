#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

const server = new McpServer({
  name: "terminal",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

server.tool(
  "execute-command",
  "Execute a command in the terminal",
  {
    command: z.string().describe("The command to execute in the terminal"),
  },
  async ({ command }) => {
    try {
      const { stdout, stderr } = await execPromise(command);
      
      let result = "";
      if (stdout) {
        result += `Standard Output:\n${stdout}\n`;
      }
      if (stderr) {
        result += `Standard Error:\n${stderr}\n`;
      }
      
      if (!result) {
        result = "Command executed successfully with no output.";
      }
      
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing command: ${error.message}`,
          },
        ],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Terminal MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});