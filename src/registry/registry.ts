import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { REGISTRY_PORT } from "../config";

export type Node = { nodeId: number; pubKey: string };
export type RegisterNodeBody = { nodeId: number; pubKey: string };
export type GetNodeRegistryBody = { nodes: Node[] };

export async function launchRegistry() {
  const _registry = express();
  _registry.use(express.json());
  _registry.use(bodyParser.json());

  let nodes: Node[] = [];

  // Status route
  _registry.get("/status", (req, res) => {
    res.send("live");
  });

  // Register node
  _registry.post("/registerNode", (req: Request, res: Response) => {
    const { nodeId, pubKey } = req.body as RegisterNodeBody;
    const existingNode = nodes.find((n) => n.nodeId === nodeId);
    if (existingNode) {
      existingNode.pubKey = pubKey; // Update pubKey if node exists
    } else {
      nodes.push({ nodeId, pubKey }); // Add new node
    }
    res.status(200).json({ success: true });
  });

  // Get node registry
  _registry.get("/getNodeRegistry", (req: Request, res: Response) => {
    const response: GetNodeRegistryBody = { nodes };
    res.json(response);
  });

  const server = _registry.listen(REGISTRY_PORT, () => {
    console.log(`Registry is listening on port ${REGISTRY_PORT}`);
  });

  return server;
}