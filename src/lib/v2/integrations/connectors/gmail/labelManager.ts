import type { gmail_v1 } from "googleapis";
import { resolveLabelColor, type LabelColorPair } from "./labelColors";

/**
 * SPEC-D G3.1 — verbatim-adapt of AOC integrations/gmail/src/mcp/label-manager.ts
 * (any→gmail_v1.Gmail typing; logic unchanged).
 */

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
}

export interface LabelOptions {
  messageListVisibility?: string;
  labelListVisibility?: string;
  color?: string | LabelColorPair;
}

/** Creates a new Gmail label. */
export async function createLabel(
  gmail: gmail_v1.Gmail,
  labelName: string,
  options: LabelOptions = {},
) {
  try {
    // Resolve color before any network call so invalid input fails fast.
    const resolvedColor =
      options.color !== undefined ? resolveLabelColor(options.color) : undefined;

    const messageListVisibility = options.messageListVisibility || "show";
    const labelListVisibility = options.labelListVisibility || "labelShow";

    const requestBody: {
      name: string;
      messageListVisibility: string;
      labelListVisibility: string;
      color?: LabelColorPair;
    } = {
      name: labelName,
      messageListVisibility,
      labelListVisibility,
    };

    if (resolvedColor) requestBody.color = resolvedColor;

    const response = await gmail.users.labels.create({
      userId: "me",
      requestBody,
    });

    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Handle duplicate labels more gracefully
    if (message.includes("already exists")) {
      throw new Error(`Label "${labelName}" already exists. Please use a different name.`);
    }
    throw new Error(`Failed to create label: ${message}`);
  }
}

/**
 * Updates an existing Gmail label via labels.patch (partial update) so omitted
 * fields are preserved.
 */
export async function updateLabel(
  gmail: gmail_v1.Gmail,
  labelId: string,
  updates: {
    name?: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: string | LabelColorPair;
  },
) {
  try {
    // Resolve/validate color first so invalid input never hits the network.
    const resolvedColor =
      updates.color !== undefined ? resolveLabelColor(updates.color) : undefined;

    // Verify the label exists before updating
    await gmail.users.labels.get({ userId: "me", id: labelId });

    const requestBody: Record<string, unknown> = {};
    if (updates.name !== undefined) requestBody.name = updates.name;
    if (updates.messageListVisibility !== undefined) {
      requestBody.messageListVisibility = updates.messageListVisibility;
    }
    if (updates.labelListVisibility !== undefined) {
      requestBody.labelListVisibility = updates.labelListVisibility;
    }
    if (resolvedColor) requestBody.color = resolvedColor;

    const response = await gmail.users.labels.patch({
      userId: "me",
      id: labelId,
      requestBody,
    });

    return response.data;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      throw new Error(`Label with ID "${labelId}" not found.`);
    }
    throw new Error(
      `Failed to update label: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Deletes a Gmail label (system labels refused). */
export async function deleteLabel(gmail: gmail_v1.Gmail, labelId: string) {
  try {
    // Ensure we're not trying to delete system labels
    const label = await gmail.users.labels.get({ userId: "me", id: labelId });

    if (label.data.type === "system") {
      throw new Error(`Cannot delete system label with ID "${labelId}".`);
    }

    await gmail.users.labels.delete({ userId: "me", id: labelId });

    return { success: true, message: `Label "${label.data.name}" deleted successfully.` };
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      throw new Error(`Label with ID "${labelId}" not found.`);
    }
    throw new Error(
      `Failed to delete label: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Gets a detailed list of all Gmail labels grouped by type. */
export async function listLabels(gmail: gmail_v1.Gmail) {
  try {
    const response = await gmail.users.labels.list({ userId: "me" });

    const labels = (response.data.labels || []) as GmailLabel[];
    const systemLabels = labels.filter((label) => label.type === "system");
    const userLabels = labels.filter((label) => label.type === "user");

    return {
      all: labels,
      system: systemLabels,
      user: userLabels,
      count: {
        total: labels.length,
        system: systemLabels.length,
        user: userLabels.length,
      },
    };
  } catch (error) {
    throw new Error(`Failed to list labels: ${error}`);
  }
}

/** Finds a label by name (case-insensitive). */
export async function findLabelByName(gmail: gmail_v1.Gmail, labelName: string) {
  try {
    const labelsResponse = await listLabels(gmail);
    const foundLabel = labelsResponse.all.find(
      (label) => label.name.toLowerCase() === labelName.toLowerCase(),
    );
    return foundLabel || null;
  } catch (error) {
    throw new Error(
      `Failed to find label: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Creates label if it doesn't exist or returns the existing label. */
export async function getOrCreateLabel(
  gmail: gmail_v1.Gmail,
  labelName: string,
  options: LabelOptions = {},
) {
  try {
    const existingLabel = await findLabelByName(gmail, labelName);
    if (existingLabel) return existingLabel;
    return await createLabel(gmail, labelName, options);
  } catch (error) {
    throw new Error(
      `Failed to get or create label: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
