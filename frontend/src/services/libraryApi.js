import { apiGet } from "./api";

export async function getCards() {
  return apiGet("/cards");
}