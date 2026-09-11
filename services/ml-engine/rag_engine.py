from langchain.docstore.document import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

def process_and_store_pgn(pgn_text: str, vector_store):
    """Splits raw PGN game strings into semantic chunks and adds them to pgvector."""
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = splitter.split_text(pgn_text)
    
    documents = [Document(page_content=chunk) for chunk in chunks]
    vector_store.add_documents(documents)
    return len(documents)

def retrieve_similar_games(query: str, vector_store, k: int = 2):
    """Performs a vector similarity search to find relevant game text for an opponent query."""
    results = vector_store.similarity_search(query, k=k)
    return [doc.page_content for doc in results]