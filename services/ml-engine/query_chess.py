from rag_store import get_vector_store

def search_chess_games(query: str, k: int = 2):
    vector_store = get_vector_store()
    
    # Perform similarity search with distance scores
    results = vector_store.similarity_search_with_score(query, k=k)
    
    print(f"\n--- Query: '{query}' ---")
    for idx, (doc, score) in enumerate(results, 1):
        print(f"\nResult {idx} (Distance Score: {score:.4f}):")
        print(f"Content:\n{doc.page_content}")
        print(f"Metadata: {doc.metadata}")

if __name__ == "__main__":
    # Test query looking for a specific opponent strategy
    search_chess_games("Magnus Carlsen attacking lines")