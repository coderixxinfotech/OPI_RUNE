import os

def initialize_env():
    env_file_path = ".env"
    with open(env_file_path, "w") as env_file:
        env_file.write(f"MAIN_POSTGRES_DB_USERNAME={os.getenv('MAIN_POSTGRES_DB_USERNAME', 'postgres')}\n")
        env_file.write(f"MAIN_POSTGRES_DB_PASSWORD={os.getenv('MAIN_POSTGRES_DB_PASSWORD', 'postgres')}\n")
        env_file.write(f"MAIN_POSTGRES_DB_NAME={os.getenv('MAIN_POSTGRES_DB_NAME', 'postgres')}\n")
    print("Environment variables have been successfully written to .env file")

if __name__ == "__main__":
    initialize_env()
