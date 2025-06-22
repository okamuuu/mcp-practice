import * as readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { intro, isCancel, select, text } from "@clack/prompts";

type Tool = {
  name: string;
  description: string;
  inputSchema: {
    properties: Record<string, any>;
  };
};

type Resource = {
  uri: string;
  name: string;
};

type Content = {
  text: string;
};

(async function main() {
  const serverProcess = spawn("node", ["../server/dist/index.js"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  const rl = readline.createInterface({
    input: serverProcess.stdout,
    output: undefined,
  });

  let lastId = 0;

  async function send(
    method: string,
    params: object = {},
    isNotification?: boolean
  ) {
    serverProcess.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: isNotification ? undefined : lastId++,
      }) + "\n"
    );
    if (isNotification) {
      return;
    }
    const json = await rl.question("");
    return JSON.parse(json).result;
  }

  const {
    serverInfo,
    capabilities,
  }: {
    serverInfo: { name: string; version: string };
    capabilities: {
      tools?: any;
      resources?: any;
    };
  } = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "diy-client", version: "0.1.0" },
  });

  await send("notifications/initialized", {}, true);

  const tools: Tool[] = capabilities.tools
    ? (await send("tools/list", { _meta: { progressToken: 1 } })).tools
    : [];
  const resources: Resource[] = capabilities.resources
    ? (await send("resources/list", { _meta: { progressToken: 1 } })).resources
    : [];

  // console.log(tools, resources);

  intro(`Connected to ${serverInfo.name} v${serverInfo.version}`);

  function dumpContent(content: { text: string }[]) {
    for (const line of content) {
      try {
        console.log(JSON.parse(line.text));
      } catch (e) {
        console.log(line.text);
      }
    }
  }

  while (true) {
    const options = [
      { value: "tool", label: "Run a tool" },
      { value: "resource", label: "Get a resource" },
    ];
    // if (resources.length > 0) {
    //   options.unshift({ value: "resource", label: "Get a resource" });
    // }
    // if (tools.length > 0) {
    //   options.unshift({ value: "tool", label: "Run a tool" });
    // }
    const action = await select({
      message: "What would you like to do?",
      options,
    });
    if (isCancel(action)) {
      process.exit(0);
    }

    if (action === "tool") {
      const tool = await select({
        message: "Select a tool.",
        options: tools.map((tool) => ({ value: tool, label: tool.name })),
      });

      if (isCancel(tool)) {
        process.exit(0);
      }

      const args: Record<string, any> = {};
      for (const key of Object.keys(tool?.inputSchema.properties ?? {}).filter(
        (key) => tool?.inputSchema?.properties?.[key]?.type === "string"
      )) {
        const answer = await text({
          message: `${key}:`,
          initialValue: "",
        });
        if (isCancel(answer)) {
          process.exit(0);
        }
        args[key] = answer;
      }

      const {
        content,
      }: {
        content: Content[];
      } = await send("tools/call", {
        name: tool.name,
        arguments: args,
      });
      dumpContent(content);
    }

    if (action === "resource") {
      const resource = await select({
        message: "Select a resource.",
        options: resources.map((resource) => ({
          value: resource,
          label: resource.name,
        })),
      });

      if (isCancel(resource)) {
        process.exit(0);
      }

      const { contents }: { contents: Content[] } = await send(
        "resources/read",
        {
          uri: resource.uri,
        }
      );

      dumpContent(contents);
    }
  }
})();
