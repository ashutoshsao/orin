import fs from "node:fs/promises";
import * as path from "node:path";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";

const schemaString = await fs.readFile(
  path.join(import.meta.dir, "./schema.gql"),
  "utf-8",
);

type User = {
  id: string;
  username: string;
  password: string;
};

const users: User[] = [];
let nextId = 1;

const root = {
  Query: {
    getUser: (_parent: unknown, args: { id: string }) => {
      return users.find((user) => user.id === args.id) ?? null;
    },
    getUsers: () => users,
  },
  Mutation: {
    createUser: (
      _parent: unknown,
      args: { input: { username: string; password: string } },
    ) => {
      const user: User = { id: String(nextId++), ...args.input };
      users.push(user);
      return user;
    },
    updateUser: (
      _parent: unknown,
      args: { input: { id: string; username?: string; password?: string } },
    ) => {
      const user = users.find((u) => u.id === args.input.id);
      if (!user) {
        throw new Error(`No user with id ${args.input.id}`);
      }
      Object.assign(user, args.input);
      return user;
    },
    deleteUser: (_parent: unknown, args: { id: string }) => {
      const index = users.findIndex((user) => user.id === args.id);
      if (index === -1) return false;
      users.splice(index, 1);
      return true;
    },
  },
};

const server = new ApolloServer({
  typeDefs: schemaString,
  resolvers: root,
});

const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
});

console.log(`server started at ${url}`);
