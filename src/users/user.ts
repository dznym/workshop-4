import bodyParser from "body-parser";
import express from "express";
import { BASE_USER_PORT, REGISTRY_PORT, BASE_ONION_ROUTER_PORT } from "../config";
import { createRandomSymmetricKey, exportSymKey, rsaEncrypt, symEncrypt } from "../crypto";
import { GetNodeRegistryBody, Node } from "../registry/registry";

export type SendMessageBody = {
  message: string;
  destinationUserId: number;
};

export async function user(userId: number) {
  const _user = express();
  _user.use(express.json());
  _user.use(bodyParser.json());

  // State variables
  let lastReceivedMessage: string | null = null;
  let lastSentMessage: string | null = null;

  // Status endpoint
  _user.get("/status", (req, res) => res.send("live"));

  // Message reception endpoint
  _user.post("/message", (req, res) => {
    const { message } = req.body;
    lastReceivedMessage = message;
    res.status(200).send("success");
  });

  // Existing message endpoints
  _user.get("/getLastReceivedMessage", (req, res) => {
    res.json({ result: lastReceivedMessage });
  });

  _user.get("/getLastSentMessage", (req, res) => {
    res.json({ result: lastSentMessage });
  });
  let lastCircuit: number[] = [];

  // Add new endpoint
  _user.get("/getLastCircuit", (req, res) => {
    res.json({ result: lastCircuit });
  });
  _user.post("/sendMessage", async (req, res) => {
    const { message, destinationUserId } = req.body;
    lastSentMessage = message;
  
    try {
      // Get node registry
      const response = await fetch(`http://localhost:${REGISTRY_PORT}/getNodeRegistry`);
      const { nodes } = await response.json() as GetNodeRegistryBody;
      
      // Select 3 distinct nodes
      const circuit = selectRandomNodes(nodes, 3);
      lastCircuit = circuit.map(node => node.nodeId);
      const [entryNode, middleNode, exitNode] = circuit;
  
      // Generate symmetric keys
      const entryKey = await createRandomSymmetricKey();
      const middleKey = await createRandomSymmetricKey();
      const exitKey = await createRandomSymmetricKey();
  
      // Build layers from exit to entry
      let payload = message;
      
      // Exit node layer
      const exitDestination = `${BASE_USER_PORT + destinationUserId}`.padStart(10, "0");
      let layer = exitDestination + payload;
      let encryptedLayer = await symEncrypt(exitKey, layer);
      let encryptedKey = await rsaEncrypt(await exportSymKey(exitKey), exitNode.pubKey);
      payload = encryptedKey + encryptedLayer;
  
      // Middle node layer
      const middleDestination = `${BASE_ONION_ROUTER_PORT + exitNode.nodeId}`.padStart(10, "0");
      layer = middleDestination + payload;
      encryptedLayer = await symEncrypt(middleKey, layer);
      encryptedKey = await rsaEncrypt(await exportSymKey(middleKey), middleNode.pubKey);
      payload = encryptedKey + encryptedLayer;
  
      // Entry node layer
      const entryDestination = `${BASE_ONION_ROUTER_PORT + middleNode.nodeId}`.padStart(10, "0");
      layer = entryDestination + payload;
      encryptedLayer = await symEncrypt(entryKey, layer);
      encryptedKey = await rsaEncrypt(await exportSymKey(entryKey), entryNode.pubKey);
      payload = encryptedKey + encryptedLayer;
  
      // Send to entry node
      await fetch(`http://localhost:${BASE_ONION_ROUTER_PORT + entryNode.nodeId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: payload }),
      });
  
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });
  
  // Add helper function
  function selectRandomNodes(nodes: Node[], count: number): Node[] {
    // Fisher-Yates shuffle algorithm
    const shuffled = [...nodes];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
  }

  const server = _user.listen(BASE_USER_PORT + userId, () => {
    console.log(`User ${userId} listening on port ${BASE_USER_PORT + userId}`);
  });

  return server;
}