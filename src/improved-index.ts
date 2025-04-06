import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs/promises";

const execPromise = promisify(exec);

const CONFIG = {
  blockedCommands: ["rm -rf", "sudo", "wget", "curl -o"],
  timeoutMs: 30000,
  maxOutputSize: 1024 * 1024,
  allowedDirectories: ["/Users/tanmay/Documents"],
  logFile: "./terminal-mcp.log"
};

async function logActivity(action, details) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${action}: ${JSON.stringify(details)}\n`;
  
  try {
    await fs.appendFile(CONFIG.logFile, logEntry);
  } catch (error) {
    console.error("Failed to write to log file:", error);
  }
}

function validateCommand(command) {
  for (const blockedCmd of CONFIG.blockedCommands) {
    if (command.includes(blockedCmd)) {
      throw new Error(`Command contains blocked pattern: ${blockedCmd}`);
    }
  }

  let isAllowed = false;
  for (const dir of CONFIG.allowedDirectories) {
    if (command.includes(dir)) {
      isAllowed = true;
      break;
    }
  }

  const isFileOperation = /(cp|mv|rm|cat|echo.*>|touch|mkdir|rmdir)/.test(command);
  if (isFileOperation && !isAllowed) {
    throw new Error("File operations only allowed in permitted directories");
  }

  return true;
}

const server = new McpServer({
  name: "terminal",
  version: "1.1.0",
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
    timeout: z.number().optional().describe("Command timeout in milliseconds")
  },
  async ({ command, timeout = CONFIG.timeoutMs }) => {
    try {
      await logActivity("COMMAND_REQUESTED", { command });
      
      validateCommand(command);
      
      const { stdout, stderr } = await execPromise(command, { 
        timeout: Math.min(timeout, CONFIG.timeoutMs),
        maxBuffer: CONFIG.maxOutputSize
      });
      
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
      
      await logActivity("COMMAND_EXECUTED", { 
        command, 
        success: true, 
        outputSize: result.length 
      });
      
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error) {
      await logActivity("COMMAND_ERROR", { 
        command, 
        error: error.message 
      });
      
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

server.tool(
  "list_directory",
  "List files and directories in a specified path",
  {
    path: z.string().describe("The directory path to list")
  },
  async ({ path }) => {
    try {
      let isAllowed = false;
      for (const dir of CONFIG.allowedDirectories) {
        if (path.startsWith(dir)) {
          isAllowed = true;
          break;
        }
      }
      
      if (!isAllowed) {
        throw new Error(`Access denied - path outside allowed directories`);
      }
      
      const items = await fs.readdir(path, { withFileTypes: true });
      const result = items.map(item => {
        const prefix = item.isDirectory() ? "[DIR] " : "[FILE] ";
        return prefix + item.name;
      }).join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: result || "Directory is empty",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing directory: ${error.message}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "read_file",
  "Read the contents of a file",
  {
    path: z.string().describe("The file path to read")
  },
  async ({ path }) => {
    try {
      let isAllowed = false;
      for (const dir of CONFIG.allowedDirectories) {
        if (path.startsWith(dir)) {
          isAllowed = true;
          break;
        }
      }
      
      if (!isAllowed) {
        throw new Error(`Access denied - path outside allowed directories`);
      }
      
      const content = await fs.readFile(path, 'utf8');
      
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error reading file: ${error.message}`,
          },
        ],
      };
    }
  }
);

async function main() {
  try {
    await logActivity("SERVER_START", { version: "1.1.0" });
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Terminal MCP Server running on stdio");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await logActivity("SERVER_SHUTDOWN", { reason: "SIGINT" });
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await logActivity("SERVER_SHUTDOWN", { reason: "SIGTERM" });
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error in main():", error);
  logActivity("SERVER_ERROR", { error: error.message }).catch(() => {});
  process.exit(1);
});