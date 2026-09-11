import os
from rag_store import get_vector_store
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain_google_genai import ChatGoogleGenerativeAI

def generate_chess_prediction(opponent_query: str):
    # 1. Initialize the PGVector store retriever
    vector_store = get_vector_store()
    retriever = vector_store.as_retriever(search_kwargs={"k": 2})

    # 2. Set up the Gemini LLM (Using the fast, free-tier eligible Flash model)
    llm = ChatGoogleGenerativeAI(model="gemini-3.6-flash", temperature=0.3)

    # 3. Define the prompt template
    template = """You are an expert chess grandmaster and AI prediction analyst. 
    Use the following historical match context to analyze the opponent's tendencies, 
    weaknesses, and recommended countermeasures.

    Context:
    {context}

    Opponent / Situation Query: {question}

    Strategic Prediction & Counter-Strategy Analysis:"""
    
    prompt = ChatPromptTemplate.from_template(template)

    # 4. Format retrieved documents into a single string
    def format_docs(docs):
        return "\n\n".join(doc.page_content for doc in docs)

    # 5. Build the LangChain Expression Language (LCEL) chain
    rag_chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )

    # 6. Invoke the chain
    response = rag_chain.invoke(opponent_query)
    return response

# You can keep the if __name__ block for local testing
if __name__ == "__main__":
    result = generate_chess_prediction("What are Magnus Carlsen's primary weaknesses in the opening phase?")
    print(result)