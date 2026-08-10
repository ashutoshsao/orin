import fs from "node:fs/promises";
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import * as path from "node:path";
import { buildSchema } from "graphql";
const schemaString = await fs.readFile(path.join(import.meta.dir, "./schema.gql"), "utf-8");
const schema = buildSchema(schemaString)

const authMiddleware = (req, res, next) => {
  req.authHeader = req.headers.authorization;
  next();
}

const root = {
  Query: {
    getUser: ({ id: string }, req) => {
      //get user and return
      console.log(id)
    }
  },
  Mutation: {
    createUser(input: CreateUserInput): callback
  }
}

const server = new ApolloServer({
  typeDefs: schema,
  resolvers: root,
})

const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 }
})

console.log(`server started at ${url}`)
