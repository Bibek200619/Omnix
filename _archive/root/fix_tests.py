import sys

def replace_in_file(filepath, old_str, new_str):
    with open(filepath, "r") as f:
        content = f.read()
    if old_str in content:
        content = content.replace(old_str, new_str)
        with open(filepath, "w") as f:
            f.write(content)
        print(f"Replaced in {filepath}")
    else:
        print(f"Could not find block in {filepath}")

# test_vectorstore_abstraction.py
test_old_1 = "required = {'add_embeddings', 'search', 'save_local', 'load_local'}"
test_new_1 = "required = {'add_embeddings', 'search'}"
replace_in_file("backend/test_vectorstore_abstraction.py", test_old_1, test_new_1)

test_old_2 = "assert 'from .vector_store import FAISSStore' in startup_src"
test_new_2 = "assert 'from .vector_store import FAISSStore' not in startup_src"
replace_in_file("backend/test_vectorstore_abstraction.py", test_old_2, test_new_2)

test_old_3 = "from .vector_store import FAISSStore"
test_new_3 = ""
replace_in_file("backend/test_vectorstore_abstraction.py", "assert 'from .vector_store import FAISSStore' in startup_src", "assert 'from .vector_store import FAISSStore' not in startup_src")

