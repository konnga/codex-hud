import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//#region src/mcp-server.d.ts
declare function createMcpServer(): McpServer;
declare function runMcpServer(): Promise<void>;
declare function runMcpHttpServer(): Promise<void>;
//#endregion
export { createMcpServer, runMcpHttpServer, runMcpServer };
//# sourceMappingURL=mcp-server.d.mts.map