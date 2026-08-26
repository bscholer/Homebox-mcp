#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import express from "express";
import FormData from "form-data";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { createRequire } from "module";

const ATTACHMENT_TYPE_MAP: Record<string, string> = {
  receipt: "receipt",
  manual: "manual",
  photo: "photo",
  other: "attachment",
};

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load package.json for version info
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const VERSION = packageJson.version;

// Configuration interface
interface HomeboxConfig {
  homeboxUrl: string;
  email: string;
  password: string;
}

// Homebox API client
class HomeboxClient {
  private axios: AxiosInstance;
  private config: HomeboxConfig;
  private authToken: string | null = null;

  constructor(config: HomeboxConfig) {
    this.config = config;
    this.axios = axios.create({
      baseURL: config.homeboxUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async authenticate(): Promise<void> {
    try {
      const response = await this.axios.post("/api/v1/users/login", {
        username: this.config.email,
        password: this.config.password,
      });

      if (response.data && response.data.token) {
        this.authToken = response.data.token;
        this.axios.defaults.headers.common["Authorization"] = this.authToken;
      } else {
        throw new Error("Authentication failed: No token received");
      }
    } catch (error: any) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  async searchItems(query: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get("/api/v1/items", {
        params: { q: query },
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to search items: ${error.message}`);
    }
  }

  async getItem(itemId: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get(`/api/v1/items/${itemId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get item: ${error.message}`);
    }
  }

  async listLocations(): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get("/api/v1/locations");
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to list locations: ${error.message}`);
    }
  }

  async getLocation(locationId: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get(`/api/v1/locations/${locationId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get location: ${error.message}`);
    }
  }

  async listLabels(): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get("/api/v1/tags");
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to list labels: ${error.message}`);
    }
  }

  async getLabel(labelId: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get(`/api/v1/tags/${labelId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get label: ${error.message}`);
    }
  }

  async getItemsByLocation(locationId: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get("/api/v1/items", {
        params: { locations: [locationId] },
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get items by location: ${error.message}`);
    }
  }

  async getItemsByLabel(labelId: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.get("/api/v1/items", {
        params: { tags: [labelId] },
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get items by label: ${error.message}`);
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.authToken) {
      await this.authenticate();
    }
  }

  async createItem(params: {
    name: string;
    description?: string;
    locationId?: string;
    labelIds?: string[];
    purchasePrice?: number;
    purchaseDate?: string;
    purchaseFrom?: string;
    quantity?: number;
    manufacturer?: string;
    modelNumber?: string;
    serialNumber?: string;
    warrantyExpires?: string;
    warrantyDetails?: string;
    notes?: string;
  }): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const createResponse = await this.axios.post("/api/v1/items", {
        name: params.name,
        description: params.description,
        locationId: params.locationId,
        quantity: params.quantity ?? 1,
        tagIds: params.labelIds,
      });
      const item = createResponse.data;

      const hasExtendedFields = [
        params.purchasePrice,
        params.purchaseDate,
        params.purchaseFrom,
        params.manufacturer,
        params.modelNumber,
        params.serialNumber,
        params.warrantyExpires,
        params.warrantyDetails,
        params.notes,
      ].some((v) => v !== undefined);

      if (!hasExtendedFields) {
        return item;
      }

      // Extended fields (purchase/warranty/identification info) can only be
      // set via PUT, which replaces the full item, not the limited create payload.
      const updateResponse = await this.axios.put(`/api/v1/items/${item.id}`, {
        name: params.name,
        description: params.description ?? "",
        locationId: params.locationId,
        quantity: params.quantity ?? 1,
        tagIds: params.labelIds ?? [],
        purchasePrice: params.purchasePrice,
        purchaseTime: params.purchaseDate,
        purchaseFrom: params.purchaseFrom,
        manufacturer: params.manufacturer,
        modelNumber: params.modelNumber,
        serialNumber: params.serialNumber,
        warrantyExpires: params.warrantyExpires,
        warrantyDetails: params.warrantyDetails,
        notes: params.notes,
      });
      return updateResponse.data;
    } catch (error: any) {
      throw new Error(`Failed to create item: ${error.message}`);
    }
  }

  async addItemAttachment(
    itemId: string,
    filePath: string,
    name?: string,
    attachmentType?: string
  ): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const fileBuffer = readFileSync(filePath);
      const fileName = name || basename(filePath);
      const type = ATTACHMENT_TYPE_MAP[attachmentType || "other"] || "attachment";

      const form = new FormData();
      form.append("file", fileBuffer, { filename: fileName });
      form.append("name", fileName);
      form.append("type", type);

      const response = await this.axios.post(
        `/api/v1/items/${itemId}/attachments`,
        form,
        { headers: form.getHeaders() }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to add item attachment: ${error.message}`);
    }
  }

  async setItemImage(itemId: string, attachmentId: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      // The attachment update endpoint requires type/title even though only
      // `primary` is changing, or the backend rejects it with an empty-enum error.
      const item = (await this.axios.get(`/api/v1/items/${itemId}`)).data;
      const attachment = (item.attachments || []).find((a: any) => a.id === attachmentId);
      if (!attachment) {
        throw new Error(`Attachment ${attachmentId} not found on item ${itemId}`);
      }
      const response = await this.axios.put(
        `/api/v1/items/${itemId}/attachments/${attachmentId}`,
        { primary: true, type: attachment.type, title: attachment.title }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to set item image: ${error.message}`);
    }
  }

  async updateItem(itemId: string, updates: Record<string, any>): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const current = (await this.axios.get(`/api/v1/items/${itemId}`)).data;
      const payload = {
        name: updates.name ?? current.name,
        description: updates.description ?? current.description,
        locationId: updates.locationId ?? current.location?.id,
        parentId: current.parent?.id,
        quantity: updates.quantity ?? current.quantity,
        tagIds: updates.labelIds ?? (current.tags || []).map((t: any) => t.id),
        purchasePrice: updates.purchasePrice ?? current.purchasePrice,
        purchaseFrom: updates.purchaseFrom ?? current.purchaseFrom,
        purchaseTime: updates.purchaseDate ?? current.purchaseTime,
        manufacturer: updates.manufacturer ?? current.manufacturer,
        modelNumber: updates.modelNumber ?? current.modelNumber,
        serialNumber: updates.serialNumber ?? current.serialNumber,
        warrantyExpires: updates.warrantyExpires ?? current.warrantyExpires,
        warrantyDetails: updates.warrantyDetails ?? current.warrantyDetails,
        notes: updates.notes ?? current.notes,
        insured: current.insured,
        archived: current.archived,
        assetId: current.assetId,
        fields: current.fields,
        lifetimeWarranty: current.lifetimeWarranty,
        soldPrice: current.soldPrice,
        soldTime: current.soldTime,
        soldTo: current.soldTo,
        soldNotes: current.soldNotes,
        syncChildItemsLocations: current.syncChildItemsLocations,
      };
      const response = await this.axios.put(`/api/v1/items/${itemId}`, payload);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to update item: ${error.message}`);
    }
  }

  async createLocation(name: string, description?: string, parentId?: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.post("/api/v1/locations", {
        name,
        description,
        parentId,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to create location: ${error.message}`);
    }
  }

  async createLabel(name: string, color?: string, description?: string): Promise<any> {
    await this.ensureAuthenticated();
    try {
      const response = await this.axios.post("/api/v1/tags", {
        name,
        color,
        description,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to create label: ${error.message}`);
    }
  }
}

// Load configuration from multiple sources
// Priority: 1. /config/config.json (Docker volume), 2. Environment variables, 3. ./config.json
function loadConfig(): HomeboxConfig {
  // Try Docker volume mount location first
  const dockerConfigPath = "/config/config.json";
  if (existsSync(dockerConfigPath)) {
    try {
      const configData = readFileSync(dockerConfigPath, "utf-8");
      const config = JSON.parse(configData);
      console.error("Loaded configuration from /config/config.json");
      return config;
    } catch (error: any) {
      console.error("Error loading /config/config.json:", error.message);
    }
  }

  // Try environment variables
  if (process.env.HOMEBOX_URL && process.env.HOMEBOX_EMAIL && process.env.HOMEBOX_PASSWORD) {
    console.error("Loaded configuration from environment variables");
    return {
      homeboxUrl: process.env.HOMEBOX_URL,
      email: process.env.HOMEBOX_EMAIL,
      password: process.env.HOMEBOX_PASSWORD,
    };
  }

  // Try local config.json
  const localConfigPath = join(__dirname, "..", "config.json");
  if (existsSync(localConfigPath)) {
    try {
      const configData = readFileSync(localConfigPath, "utf-8");
      const config = JSON.parse(configData);
      console.error("Loaded configuration from config.json");
      return config;
    } catch (error: any) {
      console.error("Error loading config.json:", error.message);
    }
  }

  // No configuration found
  console.error("Error: No configuration found!");
  console.error("Please provide configuration via one of:");
  console.error("  1. Environment variables: HOMEBOX_URL, HOMEBOX_EMAIL, HOMEBOX_PASSWORD");
  console.error("  2. /config/config.json (for Docker)");
  console.error("  3. config.json (copy from config.json.example)");
  process.exit(1);
}

// Define available tools
const TOOLS: Tool[] = [
  {
    name: "search_items",
    description: "Search for items in your Homebox inventory by name, description, or other fields. Returns a list of matching items with their basic information.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find items",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_item",
    description: "Get detailed information about a specific item by its ID. Returns complete item details including name, description, location, labels, purchase info, warranty info, and more.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: {
          type: "string",
          description: "The ID of the item to retrieve",
        },
      },
      required: ["itemId"],
    },
  },
  {
    name: "list_locations",
    description: "List all locations in your Homebox inventory. Locations are where items are stored (e.g., 'Kitchen', 'Garage', 'Living Room'). Returns location names, IDs, and descriptions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_location",
    description: "Get detailed information about a specific location by its ID, including its name, description, and parent location if nested.",
    inputSchema: {
      type: "object",
      properties: {
        locationId: {
          type: "string",
          description: "The ID of the location to retrieve",
        },
      },
      required: ["locationId"],
    },
  },
  {
    name: "list_labels",
    description: "List all labels in your Homebox inventory. Labels are used to categorize items (e.g., 'Electronics', 'Important', 'Fragile'). Returns label names, IDs, and descriptions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_label",
    description: "Get detailed information about a specific label by its ID, including its name, description, and color.",
    inputSchema: {
      type: "object",
      properties: {
        labelId: {
          type: "string",
          description: "The ID of the label to retrieve",
        },
      },
      required: ["labelId"],
    },
  },
  {
    name: "get_items_by_location",
    description: "Get all items stored in a specific location. Useful for finding everything in a particular room or storage area.",
    inputSchema: {
      type: "object",
      properties: {
        locationId: {
          type: "string",
          description: "The ID of the location",
        },
      },
      required: ["locationId"],
    },
  },
  {
    name: "get_items_by_label",
    description: "Get all items that have a specific label. Useful for finding all items in a category (e.g., all electronics, all important items).",
    inputSchema: {
      type: "object",
      properties: {
        labelId: {
          type: "string",
          description: "The ID of the label",
        },
      },
      required: ["labelId"],
    },
  },
  {
    name: "create_item",
    description: "Create a new inventory item in Homebox.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Item name" },
        description: { type: "string", description: "Item description" },
        location_id: { type: "string", description: "ID of the location to store the item in" },
        label_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs of labels/tags to apply to the item",
        },
        purchase_price: { type: "number", description: "Purchase price" },
        purchase_date: { type: "string", description: "Purchase date, ISO 8601 datetime" },
        purchase_from: { type: "string", description: "Where the item was purchased from" },
        quantity: { type: "integer", description: "Quantity of the item", default: 1 },
        manufacturer: { type: "string", description: "Manufacturer name" },
        model_number: { type: "string", description: "Model number" },
        serial_number: { type: "string", description: "Serial number" },
        warranty_expires: { type: "string", description: "Warranty expiration date, ISO 8601 date" },
        warranty_details: { type: "string", description: "Warranty details" },
        notes: { type: "string", description: "Free-form notes" },
      },
      required: ["name"],
    },
  },
  {
    name: "add_item_attachment",
    description: "Attach a file (receipt, manual, photo, or other document) to an item.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "ID of the item to attach the file to" },
        file_path: { type: "string", description: "Local path to the file to upload" },
        name: { type: "string", description: "Name for the attachment (defaults to the file's basename)" },
        attachment_type: {
          type: "string",
          enum: ["receipt", "manual", "photo", "other"],
          description: "Type of attachment",
        },
      },
      required: ["item_id", "file_path"],
    },
  },
  {
    name: "set_item_image",
    description: "Promote an existing attachment to be the item's primary image. Only takes effect for attachments with type 'photo' — Homebox ignores the primary flag on other attachment types (receipts, manuals, etc).",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "ID of the item" },
        attachment_id: { type: "string", description: "ID of the attachment to set as primary" },
      },
      required: ["item_id", "attachment_id"],
    },
  },
  {
    name: "update_item",
    description: "Update an existing item. Only the fields provided are changed; everything else is left as-is.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "ID of the item to update" },
        name: { type: "string", description: "Item name" },
        description: { type: "string", description: "Item description" },
        location_id: { type: "string", description: "ID of the location to store the item in" },
        label_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs of labels/tags to apply to the item",
        },
        purchase_price: { type: "number", description: "Purchase price" },
        purchase_date: { type: "string", description: "Purchase date, ISO 8601 datetime" },
        purchase_from: { type: "string", description: "Where the item was purchased from" },
        quantity: { type: "integer", description: "Quantity of the item" },
        manufacturer: { type: "string", description: "Manufacturer name" },
        model_number: { type: "string", description: "Model number" },
        serial_number: { type: "string", description: "Serial number" },
        warranty_expires: { type: "string", description: "Warranty expiration date, ISO 8601 date" },
        warranty_details: { type: "string", description: "Warranty details" },
        notes: { type: "string", description: "Free-form notes" },
      },
      required: ["item_id"],
    },
  },
  {
    name: "create_location",
    description: "Create a new location for storing items.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Location name" },
        description: { type: "string", description: "Location description" },
        parent_id: { type: "string", description: "ID of the parent location, if nested" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_label",
    description: "Create a new label/tag for categorizing items.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Label name" },
        color: { type: "string", description: "Label color" },
        description: { type: "string", description: "Label description" },
      },
      required: ["name"],
    },
  },
];

// Main server setup
async function main() {
  console.error("=".repeat(60));
  console.error("Homebox MCP Server v" + VERSION);
  console.error("=".repeat(60));
  console.error("Node version:", process.version);
  console.error("Platform:", process.platform);
  console.error("Build date:", new Date().toISOString());

  try {
    console.error("Loading configuration...");
    const config = loadConfig();
    console.error("Configuration loaded successfully");

    console.error("Creating Homebox client...");
    const homeboxClient = new HomeboxClient(config);

    // Test authentication on startup
    console.error("Attempting authentication with Homebox...");
    try {
      await homeboxClient.authenticate();
      console.error("Successfully authenticated with Homebox");
    } catch (error: any) {
      console.error("Failed to authenticate with Homebox:", error.message);
      console.error("Please check your config.json settings");
      process.exit(1);
    }

    console.error("Creating MCP Server instance...");
    const server = new Server(
      {
        name: "homebox-mcp-server",
        version: VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    console.error("MCP Server instance created");

    console.error("Setting up request handlers...");
    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.error("ListTools request received");
      return { tools: TOOLS };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.error("CallTool request received:", request.params.name);
      const { name, arguments: args } = request.params;

      try {
        if (!args) {
          throw new Error("Missing arguments");
        }

        switch (name) {
        case "search_items": {
          const result = await homeboxClient.searchItems(args.query as string);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_item": {
          const result = await homeboxClient.getItem(args.itemId as string);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "list_locations": {
          const result = await homeboxClient.listLocations();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_location": {
          const result = await homeboxClient.getLocation(args.locationId as string);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "list_labels": {
          const result = await homeboxClient.listLabels();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_label": {
          const result = await homeboxClient.getLabel(args.labelId as string);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_items_by_location": {
          const result = await homeboxClient.getItemsByLocation(args.locationId as string);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "get_items_by_label": {
          const result = await homeboxClient.getItemsByLabel(args.labelId as string);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "create_item": {
          const result = await homeboxClient.createItem({
            name: args.name as string,
            description: args.description as string | undefined,
            locationId: args.location_id as string | undefined,
            labelIds: args.label_ids as string[] | undefined,
            purchasePrice: args.purchase_price as number | undefined,
            purchaseDate: args.purchase_date as string | undefined,
            purchaseFrom: args.purchase_from as string | undefined,
            quantity: args.quantity as number | undefined,
            manufacturer: args.manufacturer as string | undefined,
            modelNumber: args.model_number as string | undefined,
            serialNumber: args.serial_number as string | undefined,
            warrantyExpires: args.warranty_expires as string | undefined,
            warrantyDetails: args.warranty_details as string | undefined,
            notes: args.notes as string | undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "add_item_attachment": {
          const result = await homeboxClient.addItemAttachment(
            args.item_id as string,
            args.file_path as string,
            args.name as string | undefined,
            args.attachment_type as string | undefined
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "set_item_image": {
          const result = await homeboxClient.setItemImage(
            args.item_id as string,
            args.attachment_id as string
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "update_item": {
          const { item_id, ...rest } = args as Record<string, any>;
          const updates: Record<string, any> = {};
          if (rest.name !== undefined) updates.name = rest.name;
          if (rest.description !== undefined) updates.description = rest.description;
          if (rest.location_id !== undefined) updates.locationId = rest.location_id;
          if (rest.label_ids !== undefined) updates.labelIds = rest.label_ids;
          if (rest.purchase_price !== undefined) updates.purchasePrice = rest.purchase_price;
          if (rest.purchase_date !== undefined) updates.purchaseDate = rest.purchase_date;
          if (rest.purchase_from !== undefined) updates.purchaseFrom = rest.purchase_from;
          if (rest.quantity !== undefined) updates.quantity = rest.quantity;
          if (rest.manufacturer !== undefined) updates.manufacturer = rest.manufacturer;
          if (rest.model_number !== undefined) updates.modelNumber = rest.model_number;
          if (rest.serial_number !== undefined) updates.serialNumber = rest.serial_number;
          if (rest.warranty_expires !== undefined) updates.warrantyExpires = rest.warranty_expires;
          if (rest.warranty_details !== undefined) updates.warrantyDetails = rest.warranty_details;
          if (rest.notes !== undefined) updates.notes = rest.notes;

          const result = await homeboxClient.updateItem(item_id as string, updates);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "create_location": {
          const result = await homeboxClient.createLocation(
            args.name as string,
            args.description as string | undefined,
            args.parent_id as string | undefined
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case "create_label": {
          const result = await homeboxClient.createLabel(
            args.name as string,
            args.color as string | undefined,
            args.description as string | undefined
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    });
    console.error("Request handlers configured");

    // Start the server
    if (process.env.MCP_TRANSPORT === "http") {
      const port = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
      const app = express();
      app.use(express.json());

      app.post("/mcp", async (req, res) => {
        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          res.on("close", () => transport.close());
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } catch (error: any) {
          console.error("Error handling MCP request:", error);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            });
          }
        }
      });

      const methodNotAllowed = (_req: express.Request, res: express.Response) => {
        res.status(405).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        });
      };
      app.get("/mcp", methodNotAllowed);
      app.delete("/mcp", methodNotAllowed);

      app.listen(port, "0.0.0.0", () => {
        console.error(`Homebox MCP Server running on http://0.0.0.0:${port}/mcp`);
      });
      console.error("Server is ready to accept requests");
    } else {
      console.error("Creating stdio transport...");
      const transport = new StdioServerTransport();
      console.error("Stdio transport created");

      console.error("Connecting server to transport...");
      await server.connect(transport);
      console.error("Homebox MCP Server running on stdio");
      console.error("Server is ready to accept requests");
    }

  } catch (error: any) {
    console.error("Error in main():", error);
    console.error("Stack trace:", error.stack);
    throw error;
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  console.error("Error details:", JSON.stringify(error, null, 2));
  process.exit(1);
});
