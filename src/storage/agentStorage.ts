import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { MemoryStorage, type Storage, type StoreItem } from '@microsoft/agents-hosting';

interface AgentStorageStatus {
  backend: 'cosmos' | 'memory';
  configured: boolean;
  cosmosEndpointConfigured: boolean;
  cosmosDatabaseConfigured: boolean;
  cosmosContainerConfigured: boolean;
}

const partitionKey = 'agent-state';
let storageStatus: AgentStorageStatus = {
  backend: 'memory',
  configured: false,
  cosmosEndpointConfigured: Boolean(process.env.COSMOS_DB_ENDPOINT),
  cosmosDatabaseConfigured: Boolean(process.env.COSMOS_DB_DATABASE),
  cosmosContainerConfigured: Boolean(process.env.COSMOS_DB_CONTAINER),
};

function storageId(key: string): string {
  return Buffer.from(key).toString('base64url');
}

class CosmosAgentStorage implements Storage {
  private readonly client: CosmosClient;

  constructor(
    private readonly endpoint: string,
    private readonly databaseId: string,
    private readonly containerId: string,
  ) {
    this.client = new CosmosClient({
      endpoint: this.endpoint,
      key: process.env.COSMOS_DB_KEY,
      aadCredentials: process.env.COSMOS_DB_KEY ? undefined : new DefaultAzureCredential(),
    });
  }

  async read(keys: string[]): Promise<StoreItem> {
    if (!keys?.length) throw new Error('CosmosAgentStorage.read requires at least one key.');
    const ids = keys.map(storageId);
    const parameters = ids.map((id, index) => ({ name: `@id${index}`, value: id }));
    const query = `SELECT * FROM c WHERE c.id IN (${parameters.map((parameter) => parameter.name).join(',')})`;
    const { resources } = await this.client
      .database(this.databaseId)
      .container(this.containerId)
      .items.query({ query, parameters })
      .fetchAll();

    return resources.reduce<StoreItem>((output, item) => {
      if (item?.key && item?.value) output[item.key] = item.value;
      return output;
    }, {});
  }

  async write(changes: StoreItem): Promise<void> {
    if (!changes || Object.keys(changes).length === 0) throw new Error('CosmosAgentStorage.write requires changes.');
    const container = this.client.database(this.databaseId).container(this.containerId);
    await Promise.all(Object.entries(changes).map(([key, value]) => container.items.upsert({
      id: storageId(key),
      partitionKey,
      key,
      value,
      updatedAt: new Date().toISOString(),
    })));
  }

  async delete(keys: string[]): Promise<void> {
    if (!keys?.length) return;
    const container = this.client.database(this.databaseId).container(this.containerId);
    const existing = await this.read(keys);
    await Promise.all(Object.keys(existing).map((key) => {
      const id = storageId(key);
      return container.item(id, partitionKey).delete().catch(() => container.item(id, id).delete().catch(() => undefined));
    }));
  }
}

export function createAgentStorage(): Storage {
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const databaseId = process.env.COSMOS_DB_DATABASE;
  const containerId = process.env.COSMOS_DB_CONTAINER;

  storageStatus = {
    backend: endpoint && databaseId && containerId ? 'cosmos' : 'memory',
    configured: Boolean(endpoint && databaseId && containerId),
    cosmosEndpointConfigured: Boolean(endpoint),
    cosmosDatabaseConfigured: Boolean(databaseId),
    cosmosContainerConfigured: Boolean(containerId),
  };

  if (endpoint && databaseId && containerId) {
    return new CosmosAgentStorage(endpoint, databaseId, containerId);
  }
  return new MemoryStorage();
}

export function getAgentStorageStatus(): AgentStorageStatus {
  return { ...storageStatus };
}
