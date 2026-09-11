from rag_store import get_vector_store
from langchain_core.documents import Document

def ingest_sample_games():
    # Sample chess game records / analyses to seed your RAG database
    chess_documents = [
        Document(
            page_content="Game 1: White opens with 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5. This is the Italian Game, Giuoco Piano. White targets f7.",
            metadata={"opening": "Italian Game", "result": "1-0", "eco": "C50"}
        ),
        Document(
            page_content="Game 2: Sicilian Defense: 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6. Highly tactical, sharp asymmetrical play.",
            metadata={"opening": "Sicilian Defense", "result": "1/2-1/2", "eco": "B90"}
        ),
        Document(
            page_content="Game 3: Queen's Gambit: 1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7. Classical closed game focusing on central control and minor piece maneuvering.",
            metadata={"opening": "Queen's Gambit Declined", "result": "1-0", "eco": "D30"}
        )
    ]

    vector_store = get_vector_store()
    
    # Add documents to the docker pgvector table
    vector_store.add_documents(chess_documents)
    print(f"Successfully ingested {len(chess_documents)} chess game documents into Docker PostgreSQL!")

if __name__ == "__main__":
    ingest_sample_games()